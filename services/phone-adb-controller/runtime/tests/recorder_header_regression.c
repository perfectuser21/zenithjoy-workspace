/* Only queue/mutex input setup is a fixture. The actual patched upstream header
 * function below calls real libavformat/AVIO, including real write failures. */
#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/channel_layout.h>
#include <libavutil/mathematics.h>
#include <libavutil/mem.h>
struct sc_recorder {
    AVFormatContext *ctx;
    const char *filename;
    bool stopped, video, audio, video_init, audio_init, audio_expects_config_packet;
    int mutex, cond, video_queue, audio_queue;
    struct { int index; } video_stream, audio_stream;
};
static void sc_mutex_lock(int *m) { assert(!*m); *m=1; }
static void sc_mutex_unlock(int *m) { assert(*m==1); *m=0; }
static void sc_cond_wait(int *c, int *m) { (void)c; (void)m; assert(false); }
static bool sc_recorder_must_wait_for_config_packets(struct sc_recorder *r) { (void)r; return false; }
static bool sc_vecdeque_is_empty(int *q) { assert(!*q); return true; }
static AVPacket *sc_vecdeque_pop(int *q) { (void)q; assert(false); return NULL; }
static bool sc_recorder_set_extradata(AVStream *s, AVPacket *p) { (void)s; (void)p; assert(false); return false; }
#define LOGE(...) do { fprintf(stderr,__VA_ARGS__); fputc('\n',stderr); } while(0)
/* ACTUAL_UPSTREAM_HEADER_FUNCTION */
static int failed_writes;
static int fail_write(void *opaque, const uint8_t *bytes, int n) {
    (void)opaque; (void)bytes; (void)n; ++failed_writes; return AVERROR(EIO);
}
int main(int argc,char **argv) {
    assert(argc==3);
    assert((avformat_version()>>16)==LIBAVFORMAT_VERSION_MAJOR);
    struct sc_recorder r={.filename=argv[2],.audio=true,.audio_init=true};
    assert(avformat_alloc_output_context2(&r.ctx,NULL,"matroska",argv[2])==0);
    AVStream *stream=avformat_new_stream(r.ctx,NULL); assert(stream);
    stream->codecpar->codec_type=AVMEDIA_TYPE_AUDIO;
    stream->codecpar->codec_id=AV_CODEC_ID_PCM_S16LE;
    stream->codecpar->sample_rate=48000;
    stream->codecpar->bits_per_coded_sample=16;
    stream->codecpar->bits_per_raw_sample=16;
    av_channel_layout_default(&stream->codecpar->ch_layout,2);
    stream->time_base=(AVRational){1,48000};
    bool fault=!strcmp(argv[1],"write-error"),bad_header=!strcmp(argv[1],"header-error");
    if(fault) {
        uint8_t *buffer=av_malloc(32768); assert(buffer);
        r.ctx->pb=avio_alloc_context(buffer,32768,1,NULL,NULL,fail_write,NULL);
        assert(r.ctx->pb); r.ctx->flags|=AVFMT_FLAG_CUSTOM_IO;
    } else assert(avio_open(&r.ctx->pb,argv[2],AVIO_FLAG_WRITE)==0);
    if(bad_header)stream->codecpar->sample_rate=0;
    bool ok=sc_recorder_process_header(&r);
    assert(r.mutex==0);
    if(fault) {
        assert(!ok); assert(failed_writes==1); assert(r.ctx->pb->error==AVERROR(EIO));
        av_freep(&r.ctx->pb->buffer); avio_context_free(&r.ctx->pb);
    } else if(bad_header) {
        assert(!ok); avio_closep(&r.ctx->pb);
    } else {
        assert(ok); struct stat st; assert(!stat(argv[2],&st));
        /* Assert while live, before any packet or trailer, not after close. */
        assert(st.st_size>0); assert(!r.ctx->pb->error);
        for(int i=0;i<10;i++) {
            AVPacket *p=av_packet_alloc();assert(p&&av_new_packet(p,480*2*2)==0);
            memset(p->data,0,p->size);p->stream_index=0;
            p->pts=p->dts=av_rescale_q(i*480,(AVRational){1,48000},stream->time_base);
            p->duration=av_rescale_q(480,(AVRational){1,48000},stream->time_base);
            assert(av_interleaved_write_frame(r.ctx,p)==0);av_packet_free(&p);
        }
        assert(av_write_trailer(r.ctx)==0);assert(avio_closep(&r.ctx->pb)==0);
    }
    printf("{\"header_version\":%u,\"runtime_version\":%u,\"case\":\"%s\"}\n",
           LIBAVFORMAT_VERSION_INT,avformat_version(),argv[1]);
    avformat_free_context(r.ctx);return 0;
}
