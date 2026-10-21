    if (video_pkt) {
        av_packet_free(&video_pkt);
    }
    if (audio_pkt) {
        av_packet_free(&audio_pkt);
    }

    return !error;
}

static bool
sc_recorder_record(struct sc_recorder *recorder) {
    bool ok = sc_recorder_open_output_file(recorder);
    if (!ok) {
        return false;
    }

    ok = sc_recorder_process_packets(recorder);
    sc_recorder_close_output_file(recorder);
    return ok;
}

static int
run_recorder(void *data) {
    struct sc_recorder *recorder = data;

    // Recording is a background task
    bool ok = sc_thread_set_priority(SC_THREAD_PRIORITY_LOW);
    (void) ok; // We don't care if it worked

    bool success = sc_recorder_record(recorder);

    sc_mutex_lock(&recorder->mutex);
    // Prevent the producer to push any new packet
    recorder->stopped = true;
    // Discard pending packets
    sc_recorder_queue_clear(&recorder->video_queue);
    sc_recorder_queue_clear(&recorder->audio_queue);
    sc_mutex_unlock(&recorder->mutex);

    if (success) {
        const char *format_name = sc_recorder_get_format_name(recorder->format);
        LOGI("Recording complete to %s file: %s", format_name,
                                                  recorder->filename);
    } else {
        LOGE("Recording failed to %s", recorder->filename);
    }

    LOGD("Recorder thread ended");

    recorder->cbs->on_ended(recorder, success, recorder->cbs_userdata);

    return 0;
}

static bool
sc_recorder_set_orientation(AVStream *stream, enum sc_orientation orientation) {
    assert(!sc_orientation_is_mirror(orientation));

    uint8_t *raw_data;
#ifdef SCRCPY_LAVC_HAS_CODECPAR_CODEC_SIDEDATA
    AVPacketSideData *sd =
        av_packet_side_data_new(&stream->codecpar->coded_side_data,
                                &stream->codecpar->nb_coded_side_data,
                                AV_PKT_DATA_DISPLAYMATRIX,
                                sizeof(int32_t) * 9, 0);
    if (!sd) {
        LOG_OOM();
        return false;
    }

    raw_data = sd->data;
#else
    raw_data = av_stream_new_side_data(stream, AV_PKT_DATA_DISPLAYMATRIX,
                                      sizeof(int32_t) * 9);
    if (!raw_data) {
        LOG_OOM();
        return false;
    }
#endif

    int32_t *matrix = (int32_t *) raw_data;

    unsigned rotation = orientation;
    unsigned angle = rotation * 90;

    av_display_rotation_set(matrix, angle);

    return true;
}

static bool
sc_recorder_video_packet_sink_open(struct sc_packet_sink *sink,
                                   AVCodecContext *ctx) {
    struct sc_recorder *recorder = DOWNCAST_VIDEO(sink);
    // only written from this thread, no need to lock
    assert(!recorder->video_init);

    sc_mutex_lock(&recorder->mutex);
    if (recorder->stopped) {
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    AVStream *stream = avformat_new_stream(recorder->ctx, ctx->codec);
    if (!stream) {
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    int r = avcodec_parameters_from_context(stream->codecpar, ctx);
    if (r < 0) {
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    recorder->video_stream.index = stream->index;

    if (recorder->orientation != SC_ORIENTATION_0) {
        if (!sc_recorder_set_orientation(stream, recorder->orientation)) {
            sc_mutex_unlock(&recorder->mutex);
            return false;
        }

        LOGI("Record orientation set to %s",
             sc_orientation_get_name(recorder->orientation));
    }

    recorder->video_init = true;
    sc_cond_signal(&recorder->cond);
    sc_mutex_unlock(&recorder->mutex);

    return true;
}

static void
sc_recorder_video_packet_sink_close(struct sc_packet_sink *sink) {
    struct sc_recorder *recorder = DOWNCAST_VIDEO(sink);
    // only written from this thread, no need to lock
    assert(recorder->video_init);

    sc_mutex_lock(&recorder->mutex);
    // EOS also stops the recorder
    recorder->stopped = true;
    sc_cond_signal(&recorder->cond);
    sc_mutex_unlock(&recorder->mutex);
}

static bool
sc_recorder_video_packet_sink_push(struct sc_packet_sink *sink,
                                   const AVPacket *packet) {
    struct sc_recorder *recorder = DOWNCAST_VIDEO(sink);
    // only written from this thread, no need to lock
    assert(recorder->video_init);

    sc_mutex_lock(&recorder->mutex);

    if (recorder->stopped) {
        // reject any new packet
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    AVPacket *rec = sc_recorder_packet_ref(packet);
    if (!rec) {
        LOG_OOM();
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    rec->stream_index = recorder->video_stream.index;

    bool ok = sc_vecdeque_push(&recorder->video_queue, rec);
    if (!ok) {
        LOG_OOM();
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    sc_cond_signal(&recorder->cond);

    sc_mutex_unlock(&recorder->mutex);
    return true;
}

static bool
sc_recorder_audio_packet_sink_open(struct sc_packet_sink *sink,
                                   AVCodecContext *ctx) {
    struct sc_recorder *recorder = DOWNCAST_AUDIO(sink);
    assert(recorder->audio);
    // only written from this thread, no need to lock
    assert(!recorder->audio_init);

    sc_mutex_lock(&recorder->mutex);

    AVStream *stream = avformat_new_stream(recorder->ctx, ctx->codec);
    if (!stream) {
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    int r = avcodec_parameters_from_context(stream->codecpar, ctx);
    if (r < 0) {
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    recorder->audio_stream.index = stream->index;

    // A config packet is provided for all supported formats except raw audio
    recorder->audio_expects_config_packet =
        ctx->codec_id != AV_CODEC_ID_PCM_S16LE;

    recorder->audio_init = true;
    sc_cond_signal(&recorder->cond);
    sc_mutex_unlock(&recorder->mutex);

    return true;
}

static void
sc_recorder_audio_packet_sink_close(struct sc_packet_sink *sink) {
    struct sc_recorder *recorder = DOWNCAST_AUDIO(sink);
    assert(recorder->audio);
    // only written from this thread, no need to lock
    assert(recorder->audio_init);

    sc_mutex_lock(&recorder->mutex);
    // EOS also stops the recorder
    recorder->stopped = true;
    sc_cond_signal(&recorder->cond);
    sc_mutex_unlock(&recorder->mutex);
}

static bool
sc_recorder_audio_packet_sink_push(struct sc_packet_sink *sink,
                                   const AVPacket *packet) {
    struct sc_recorder *recorder = DOWNCAST_AUDIO(sink);
    assert(recorder->audio);
    // only written from this thread, no need to lock
    assert(recorder->audio_init);

    sc_mutex_lock(&recorder->mutex);

    if (recorder->stopped) {
        // reject any new packet
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    AVPacket *rec = sc_recorder_packet_ref(packet);
    if (!rec) {
        LOG_OOM();
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    rec->stream_index = recorder->audio_stream.index;

    bool ok = sc_vecdeque_push(&recorder->audio_queue, rec);
    if (!ok) {
        LOG_OOM();
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    sc_cond_signal(&recorder->cond);

    sc_mutex_unlock(&recorder->mutex);
    return true;
}

static void
sc_recorder_audio_packet_sink_disable(struct sc_packet_sink *sink) {
    struct sc_recorder *recorder = DOWNCAST_AUDIO(sink);
    assert(recorder->audio);
    // only written from this thread, no need to lock
    assert(!recorder->audio_init);

    LOGW("Audio stream recording disabled");

    sc_mutex_lock(&recorder->mutex);
    recorder->audio = false;
    recorder->audio_init = true;
    sc_cond_signal(&recorder->cond);
    sc_mutex_unlock(&recorder->mutex);
}

static void
sc_recorder_stream_init(struct sc_recorder_stream *stream) {
    stream->index = -1;
    stream->last_pts = AV_NOPTS_VALUE;
}

bool
sc_recorder_init(struct sc_recorder *recorder, const char *filename,
                 enum sc_record_format format, bool video, bool audio,
                 enum sc_orientation orientation,
                 const struct sc_recorder_callbacks *cbs, void *cbs_userdata) {
    assert(!sc_orientation_is_mirror(orientation));

    recorder->filename = strdup(filename);
    if (!recorder->filename) {
        LOG_OOM();
        return false;
    }

    bool ok = sc_mutex_init(&recorder->mutex);
    if (!ok) {
        goto error_free_filename;
    }

    ok = sc_cond_init(&recorder->cond);
    if (!ok) {
        goto error_mutex_destroy;
    }

    assert(video || audio);
    recorder->video = video;
    recorder->audio = audio;

    recorder->orientation = orientation;

    sc_vecdeque_init(&recorder->video_queue);
    sc_vecdeque_init(&recorder->audio_queue);
    recorder->stopped = false;

    recorder->video_init = false;
    recorder->audio_init = false;

    recorder->audio_expects_config_packet = false;

    sc_recorder_stream_init(&recorder->video_stream);
    sc_recorder_stream_init(&recorder->audio_stream);

    recorder->format = format;

    assert(cbs && cbs->on_ended);
    recorder->cbs = cbs;
    recorder->cbs_userdata = cbs_userdata;

    if (video) {
        static const struct sc_packet_sink_ops video_ops = {
            .open = sc_recorder_video_packet_sink_open,
            .close = sc_recorder_video_packet_sink_close,
            .push = sc_recorder_video_packet_sink_push,
        };

        recorder->video_packet_sink.ops = &video_ops;
    }

    if (audio) {
        static const struct sc_packet_sink_ops audio_ops = {
            .open = sc_recorder_audio_packet_sink_open,
            .close = sc_recorder_audio_packet_sink_close,
            .push = sc_recorder_audio_packet_sink_push,
            .disable = sc_recorder_audio_packet_sink_disable,
        };

        recorder->audio_packet_sink.ops = &audio_ops;
    }

    return true;

error_mutex_destroy:
    sc_mutex_destroy(&recorder->mutex);
error_free_filename:
    free(recorder->filename);

    return false;
}

bool
sc_recorder_start(struct sc_recorder *recorder) {
    bool ok = sc_thread_create(&recorder->thread, run_recorder,
                               "scrcpy-recorder", recorder);
    if (!ok) {
        LOGE("Could not start recorder thread");
        return false;
    }

    return true;
}

void
sc_recorder_stop(struct sc_recorder *recorder) {
    sc_mutex_lock(&recorder->mutex);
    recorder->stopped = true;
    sc_cond_signal(&recorder->cond);
    sc_mutex_unlock(&recorder->mutex);
}

void
sc_recorder_join(struct sc_recorder *recorder) {
    sc_thread_join(&recorder->thread, NULL);
}

void
sc_recorder_destroy(struct sc_recorder *recorder) {
    sc_cond_destroy(&recorder->cond);
    sc_mutex_destroy(&recorder->mutex);
    free(recorder->filename);
}
