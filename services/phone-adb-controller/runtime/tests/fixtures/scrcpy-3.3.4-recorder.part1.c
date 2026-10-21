#include "recorder.h"

#include <assert.h>
#include <inttypes.h>
#include <stdlib.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/time.h>
#include <libavutil/display.h>

#include "util/log.h"
#include "util/str.h"

/** Downcast packet sinks to recorder */
#define DOWNCAST_VIDEO(SINK) \
    container_of(SINK, struct sc_recorder, video_packet_sink)
#define DOWNCAST_AUDIO(SINK) \
    container_of(SINK, struct sc_recorder, audio_packet_sink)

static const AVRational SCRCPY_TIME_BASE = {1, 1000000}; // timestamps in us

static const AVOutputFormat *
find_muxer(const char *name) {
#ifdef SCRCPY_LAVF_HAS_NEW_MUXER_ITERATOR_API
    void *opaque = NULL;
#endif
    const AVOutputFormat *oformat = NULL;
    do {
#ifdef SCRCPY_LAVF_HAS_NEW_MUXER_ITERATOR_API
        oformat = av_muxer_iterate(&opaque);
#else
        oformat = av_oformat_next(oformat);
#endif
        // until null or containing the requested name
    } while (oformat && !sc_str_list_contains(oformat->name, ',', name));
    return oformat;
}

static AVPacket *
sc_recorder_packet_ref(const AVPacket *packet) {
    AVPacket *p = av_packet_alloc();
    if (!p) {
        LOG_OOM();
        return NULL;
    }

    if (av_packet_ref(p, packet)) {
        av_packet_free(&p);
        return NULL;
    }

    return p;
}

static void
sc_recorder_queue_clear(struct sc_recorder_queue *queue) {
    while (!sc_vecdeque_is_empty(queue)) {
        AVPacket *p = sc_vecdeque_pop(queue);
        av_packet_free(&p);
    }
}

static const char *
sc_recorder_get_format_name(enum sc_record_format format) {
    switch (format) {
        case SC_RECORD_FORMAT_MP4:
        case SC_RECORD_FORMAT_M4A:
        case SC_RECORD_FORMAT_AAC:
            return "mp4";
        case SC_RECORD_FORMAT_MKV:
        case SC_RECORD_FORMAT_MKA:
            return "matroska";
        case SC_RECORD_FORMAT_OPUS:
            return "opus";
        case SC_RECORD_FORMAT_FLAC:
            return "flac";
        case SC_RECORD_FORMAT_WAV:
            return "wav";
        default:
            return NULL;
    }
}

static bool
sc_recorder_set_extradata(AVStream *ostream, const AVPacket *packet) {
    uint8_t *extradata = av_malloc(packet->size * sizeof(uint8_t));
    if (!extradata) {
        LOG_OOM();
        return false;
    }

    // copy the first packet to the extra data
    memcpy(extradata, packet->data, packet->size);

    ostream->codecpar->extradata = extradata;
    ostream->codecpar->extradata_size = packet->size;
    return true;
}

static inline void
sc_recorder_rescale_packet(AVStream *stream, AVPacket *packet) {
    av_packet_rescale_ts(packet, SCRCPY_TIME_BASE, stream->time_base);
}

static bool
sc_recorder_write_stream(struct sc_recorder *recorder,
                         struct sc_recorder_stream *st, AVPacket *packet) {
    AVStream *stream = recorder->ctx->streams[st->index];
    sc_recorder_rescale_packet(stream, packet);
    if (st->last_pts != AV_NOPTS_VALUE && packet->pts <= st->last_pts) {
        LOGD("Fixing PTS non monotonically increasing in stream %d "
             "(%" PRIi64 " >= %" PRIi64 ")",
             st->index, st->last_pts, packet->pts);
        packet->pts = ++st->last_pts;
        packet->dts = packet->pts;
    } else {
        st->last_pts = packet->pts;
    }
    return av_interleaved_write_frame(recorder->ctx, packet) >= 0;
}

static inline bool
sc_recorder_write_video(struct sc_recorder *recorder, AVPacket *packet) {
    return sc_recorder_write_stream(recorder, &recorder->video_stream, packet);
}

static inline bool
sc_recorder_write_audio(struct sc_recorder *recorder, AVPacket *packet) {
    return sc_recorder_write_stream(recorder, &recorder->audio_stream, packet);
}

static bool
sc_recorder_open_output_file(struct sc_recorder *recorder) {
    const char *format_name = sc_recorder_get_format_name(recorder->format);
    assert(format_name);
    const AVOutputFormat *format = find_muxer(format_name);
    if (!format) {
        LOGE("Could not find muxer");
        return false;
    }

    recorder->ctx = avformat_alloc_context();
    if (!recorder->ctx) {
        LOG_OOM();
        return false;
    }

    char *file_url = sc_str_concat("file:", recorder->filename);
    if (!file_url) {
        avformat_free_context(recorder->ctx);
        return false;
    }

    int ret = avio_open(&recorder->ctx->pb, file_url, AVIO_FLAG_WRITE);
    free(file_url);
    if (ret < 0) {
        LOGE("Failed to open output file: %s", recorder->filename);
        avformat_free_context(recorder->ctx);
        return false;
    }

    // contrary to the deprecated API (av_oformat_next()), av_muxer_iterate()
    // returns (on purpose) a pointer-to-const, but AVFormatContext.oformat
    // still expects a pointer-to-non-const (it has not be updated accordingly)
    // <https://github.com/FFmpeg/FFmpeg/commit/0694d8702421e7aff1340038559c438b61bb30dd>
    recorder->ctx->oformat = (AVOutputFormat *) format;

    av_dict_set(&recorder->ctx->metadata, "comment",
                "Recorded by scrcpy " SCRCPY_VERSION, 0);

    LOGI("Recording started to %s file: %s", format_name, recorder->filename);
    return true;
}

static void
sc_recorder_close_output_file(struct sc_recorder *recorder) {
    avio_close(recorder->ctx->pb);
    avformat_free_context(recorder->ctx);
}

static inline bool
sc_recorder_must_wait_for_config_packets(struct sc_recorder *recorder) {
    if (recorder->video && sc_vecdeque_is_empty(&recorder->video_queue)) {
        // The video queue is empty
        return true;
    }

    if (recorder->audio && recorder->audio_expects_config_packet
            && sc_vecdeque_is_empty(&recorder->audio_queue)) {
        // The audio queue is empty (when audio is enabled)
        return true;
    }

    // No queue is empty
    return false;
}

static bool
sc_recorder_process_header(struct sc_recorder *recorder) {
    sc_mutex_lock(&recorder->mutex);

    while (!recorder->stopped &&
              ((recorder->video && !recorder->video_init)
            || (recorder->audio && !recorder->audio_init)
            || sc_recorder_must_wait_for_config_packets(recorder))) {
        sc_cond_wait(&recorder->cond, &recorder->mutex);
    }

    if (recorder->video && sc_vecdeque_is_empty(&recorder->video_queue)) {
        assert(recorder->stopped);
        // If the recorder is stopped, don't process anything if there are not
        // at least video packets
        sc_mutex_unlock(&recorder->mutex);
        return false;
    }

    AVPacket *video_pkt = NULL;
    if (!sc_vecdeque_is_empty(&recorder->video_queue)) {
        assert(recorder->video);
        video_pkt = sc_vecdeque_pop(&recorder->video_queue);
    }

    AVPacket *audio_pkt = NULL;
    if (recorder->audio_expects_config_packet &&
            !sc_vecdeque_is_empty(&recorder->audio_queue)) {
        assert(recorder->audio);
        audio_pkt = sc_vecdeque_pop(&recorder->audio_queue);
    }

    sc_mutex_unlock(&recorder->mutex);

    int ret = false;

    if (video_pkt) {
        if (video_pkt->pts != AV_NOPTS_VALUE) {
            LOGE("The first video packet is not a config packet");
            goto end;
        }

        assert(recorder->video_stream.index >= 0);
        AVStream *video_stream =
            recorder->ctx->streams[recorder->video_stream.index];
        bool ok = sc_recorder_set_extradata(video_stream, video_pkt);
        if (!ok) {
            goto end;
        }
    }

    if (audio_pkt) {
        if (audio_pkt->pts != AV_NOPTS_VALUE) {
            LOGE("The first audio packet is not a config packet");
            goto end;
        }

        assert(recorder->audio_stream.index >= 0);
        AVStream *audio_stream =
            recorder->ctx->streams[recorder->audio_stream.index];
        bool ok = sc_recorder_set_extradata(audio_stream, audio_pkt);
        if (!ok) {
            goto end;
        }
    }

    bool ok = avformat_write_header(recorder->ctx, NULL) >= 0;
    if (!ok) {
        LOGE("Failed to write header to %s", recorder->filename);
        goto end;
    }

    ret = true;

end:
    if (video_pkt) {
        av_packet_free(&video_pkt);
    }
    if (audio_pkt) {
        av_packet_free(&audio_pkt);
    }

    return ret;
}

static bool
sc_recorder_process_packets(struct sc_recorder *recorder) {
    int64_t pts_origin = AV_NOPTS_VALUE;

    bool header_written = sc_recorder_process_header(recorder);
    if (!header_written) {
        return false;
    }

    AVPacket *video_pkt = NULL;
    AVPacket *audio_pkt = NULL;

    // We can write a video packet only once we received the next one so that
    // we can set its duration (next_pts - current_pts)
    AVPacket *video_pkt_previous = NULL;

    bool error = false;

    for (;;) {
        sc_mutex_lock(&recorder->mutex);

        while (!recorder->stopped) {
            if (recorder->video && !video_pkt &&
                    !sc_vecdeque_is_empty(&recorder->video_queue)) {
                // A new packet may be assigned to video_pkt and be processed
                break;
            }
            if (recorder->audio && !audio_pkt
                    && !sc_vecdeque_is_empty(&recorder->audio_queue)) {
                // A new packet may be assigned to audio_pkt and be processed
                break;
            }
            sc_cond_wait(&recorder->cond, &recorder->mutex);
        }

        // If stopped is set, continue to process the remaining events (to
        // finish the recording) before actually stopping.

        // If there is no video, then the video_queue will remain empty forever
        // and video_pkt will always be NULL.
        assert(recorder->video || (!video_pkt
                && sc_vecdeque_is_empty(&recorder->video_queue)));

        // If there is no audio, then the audio_queue will remain empty forever
        // and audio_pkt will always be NULL.
        assert(recorder->audio || (!audio_pkt
                && sc_vecdeque_is_empty(&recorder->audio_queue)));

        if (!video_pkt && !sc_vecdeque_is_empty(&recorder->video_queue)) {
            video_pkt = sc_vecdeque_pop(&recorder->video_queue);
        }

        if (!audio_pkt && !sc_vecdeque_is_empty(&recorder->audio_queue)) {
            audio_pkt = sc_vecdeque_pop(&recorder->audio_queue);
        }

        if (recorder->stopped && !video_pkt && !audio_pkt) {
            assert(sc_vecdeque_is_empty(&recorder->video_queue));
            assert(sc_vecdeque_is_empty(&recorder->audio_queue));
            sc_mutex_unlock(&recorder->mutex);
            break;
        }

        assert(video_pkt || audio_pkt); // at least one

        sc_mutex_unlock(&recorder->mutex);

        // Ignore further config packets (e.g. on device orientation
        // change). The next non-config packet will have the config packet
        // data prepended.
        if (video_pkt && video_pkt->pts == AV_NOPTS_VALUE) {
            av_packet_free(&video_pkt);
            video_pkt = NULL;
        }

        if (audio_pkt && audio_pkt->pts == AV_NOPTS_VALUE) {
            av_packet_free(&audio_pkt);
            audio_pkt = NULL;
        }

        if (pts_origin == AV_NOPTS_VALUE) {
            if (!recorder->audio) {
                assert(video_pkt);
                pts_origin = video_pkt->pts;
            } else if (!recorder->video) {
                assert(audio_pkt);
                pts_origin = audio_pkt->pts;
            } else if (video_pkt && audio_pkt) {
                pts_origin = MIN(video_pkt->pts, audio_pkt->pts);
            } else if (recorder->stopped) {
                if (video_pkt) {
                    // The recorder is stopped without audio, record the video
                    // packets
                    pts_origin = video_pkt->pts;
                } else {
                    // Fail if there is no video
                    error = true;
                    goto end;
                }
            } else {
                // We need both video and audio packets to initialize pts_origin
                continue;
            }
        }

        assert(pts_origin != AV_NOPTS_VALUE);

        if (video_pkt) {
            video_pkt->pts -= pts_origin;
            video_pkt->dts = video_pkt->pts;

            if (video_pkt_previous) {
                // we now know the duration of the previous packet
                video_pkt_previous->duration = video_pkt->pts
                                             - video_pkt_previous->pts;

                bool ok = sc_recorder_write_video(recorder, video_pkt_previous);
                av_packet_free(&video_pkt_previous);
                if (!ok) {
                    LOGE("Could not record video packet");
                    error = true;
                    goto end;
                }
            }

            video_pkt_previous = video_pkt;
            video_pkt = NULL;
        }

        if (audio_pkt) {
            audio_pkt->pts -= pts_origin;
            audio_pkt->dts = audio_pkt->pts;

            bool ok = sc_recorder_write_audio(recorder, audio_pkt);
            if (!ok) {
                LOGE("Could not record audio packet");
                error = true;
                goto end;
            }

            av_packet_free(&audio_pkt);
            audio_pkt = NULL;
        }
    }

    // Write the last video packet
    AVPacket *last = video_pkt_previous;
    if (last) {
        // assign an arbitrary duration to the last packet
        last->duration = 100000;
        bool ok = sc_recorder_write_video(recorder, last);
        if (!ok) {
            // failing to write the last frame is not very serious, no
            // future frame may depend on it, so the resulting file
            // will still be valid
            LOGW("Could not record last packet");
        }
        av_packet_free(&last);
    }

    int ret = av_write_trailer(recorder->ctx);
    if (ret < 0) {
        LOGE("Failed to write trailer to %s", recorder->filename);
        error = false;
    }

end:
