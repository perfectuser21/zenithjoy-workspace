/* Full upstream recorder, real SDL threads and FFmpeg; local PCM, no device. */
#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <SDL2/SDL.h>
#include <libavcodec/avcodec.h>
#include "recorder.h"
#include "util/log.h"
static bool ended, succeeded;
static void on_ended(struct sc_recorder *r, bool success, void *data) {
    ended = true;
    succeeded = success;
}
int main(int argc, char **argv) {
    assert(argc == 3);
    assert(SDL_Init(0) == 0);
    SC_MAIN_THREAD_ID = sc_thread_get_id();
    sc_log_configure();
    AVCodecContext *codec = avcodec_alloc_context3(avcodec_find_decoder(AV_CODEC_ID_PCM_S16LE));
    assert(codec);
    codec->codec_type = AVMEDIA_TYPE_AUDIO;
    codec->codec_id = AV_CODEC_ID_PCM_S16LE;
    codec->sample_rate = 48000;
    codec->sample_fmt = AV_SAMPLE_FMT_S16;
    av_channel_layout_default(&codec->ch_layout, 2);
    static const struct sc_recorder_callbacks cbs = {.on_ended = on_ended};
    for (int round = 0; round < 32; ++round) {
        struct sc_recorder r;
        memset(&r, 0x2a, sizeof(r));
        ended = succeeded = false;
        assert(sc_recorder_init(&r, argv[1], SC_RECORD_FORMAT_WAV, false, true,
                                SC_ORIENTATION_0, &cbs, NULL));
        assert(sc_recorder_start(&r));
        assert(r.audio_packet_sink.ops->open(&r.audio_packet_sink, codec));
        for (int n = 0; n < 10; ++n) {
            AVPacket *packet = av_packet_alloc();
            assert(packet && av_new_packet(packet, 480 * 2 * 2) == 0);
            memset(packet->data, 0, packet->size);
            packet->pts = packet->dts = n * 10000;
            assert(r.audio_packet_sink.ops->push(&r.audio_packet_sink, packet));
            av_packet_free(&packet);
        }
        r.audio_packet_sink.ops->close(&r.audio_packet_sink);
        sc_recorder_join(&r);
        assert(ended && succeeded && r.ctx == NULL);
        sc_recorder_destroy(&r);
    }
    /* Exercise the real video avformat_new_stream path and preserve both
     * streams in a real local Matroska recording, not an FFmpeg substitute. */
    AVFormatContext *input = NULL;
    assert(avformat_open_input(&input, argv[2], NULL, NULL) == 0);
    assert(avformat_find_stream_info(input, NULL) >= 0);
    int vi = av_find_best_stream(input, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
    int ai = av_find_best_stream(input, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
    assert(vi >= 0 && ai >= 0);
    AVCodecContext *video = avcodec_alloc_context3(avcodec_find_decoder(input->streams[vi]->codecpar->codec_id));
    AVCodecContext *audio = avcodec_alloc_context3(avcodec_find_decoder(input->streams[ai]->codecpar->codec_id));
    assert(video && audio);
    assert(avcodec_parameters_to_context(video, input->streams[vi]->codecpar) == 0);
    assert(avcodec_parameters_to_context(audio, input->streams[ai]->codecpar) == 0);
    char muxed[4096];
    assert(snprintf(muxed, sizeof(muxed), "%s.mkv", argv[1]) < (int)sizeof(muxed));
    struct sc_recorder av;
    ended = succeeded = false;
    assert(sc_recorder_init(&av, muxed, SC_RECORD_FORMAT_MKV, true, true,
                            SC_ORIENTATION_0, &cbs, NULL));
    assert(sc_recorder_start(&av));
    assert(av.video_packet_sink.ops->open(&av.video_packet_sink, video));
    assert(av.audio_packet_sink.ops->open(&av.audio_packet_sink, audio));
    AVPacket *packet = av_packet_alloc();
    assert(packet && video->extradata_size > 0);
    assert(av_new_packet(packet, video->extradata_size) == 0);
    memcpy(packet->data, video->extradata, packet->size);
    packet->pts = packet->dts = AV_NOPTS_VALUE;
    assert(av.video_packet_sink.ops->push(&av.video_packet_sink, packet));
    av_packet_unref(packet);
    while (av_read_frame(input, packet) >= 0) {
        if (packet->stream_index == vi || packet->stream_index == ai) {
            int index = packet->stream_index;
            av_packet_rescale_ts(packet, input->streams[index]->time_base, (AVRational){1, 1000000});
            struct sc_packet_sink *sink = index == vi ? &av.video_packet_sink : &av.audio_packet_sink;
            assert(sink->ops->push(sink, packet));
        }
        av_packet_unref(packet);
    }
    av_packet_free(&packet);
    av.video_packet_sink.ops->close(&av.video_packet_sink);
    av.audio_packet_sink.ops->close(&av.audio_packet_sink);
    sc_recorder_join(&av);
    assert(ended && succeeded && av.ctx == NULL);
    sc_recorder_destroy(&av);
    avcodec_free_context(&video);
    avcodec_free_context(&audio);
    avformat_close_input(&input);
    char valid[4096];
    assert(snprintf(valid, sizeof(valid), "%s.valid", argv[1]) < (int)sizeof(valid));
    assert(rename(argv[1], valid) == 0);
    for (int round = 0; round < 32; ++round) {
        struct sc_recorder r;
        assert(sc_recorder_init(&r, argv[1], SC_RECORD_FORMAT_WAV, false, true,
                                SC_ORIENTATION_0, &cbs, NULL));
        assert(sc_recorder_start(&r));
        sc_recorder_stop(&r);
        assert(!r.audio_packet_sink.ops->open(&r.audio_packet_sink, codec));
        sc_recorder_join(&r);
        assert(r.ctx == NULL);
        sc_recorder_destroy(&r);
    }
    avcodec_free_context(&codec);
    SDL_Quit();
    puts("PASS: 32 PCM recordings, 32 stopped audio opens and real video/audio muxing");
    return 0;
}
