/* Deterministic FFmpeg/thread boundary doubles for actual upstream C bodies.
 * No recorder algorithm is duplicated. Worker scheduling is explicitly held
 * until the producer has observed sc_recorder_start() returning. */
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define LOGI(...) ((void) 0)
#define LOGD(...) ((void) 0)
#define LOGW(...) ((void) 0)
#define LOGE(...) ((void) 0)
#define LOG_OOM() ((void) 0)
#define SCRCPY_VERSION "3.3.4"
#define AV_NOPTS_VALUE INT64_MIN
#define AVIO_FLAG_WRITE 2
#define AV_CODEC_ID_PCM_S16LE 1
#define SCRCPY_LAVF_HAS_NEW_MUXER_ITERATOR_API
#define SC_THREAD_PRIORITY_LOW 0
#define DOWNCAST_VIDEO(p) ((struct sc_recorder *) ((char *)(p) - offsetof(struct sc_recorder, video_packet_sink)))
#define DOWNCAST_AUDIO(p) ((struct sc_recorder *) ((char *)(p) - offsetof(struct sc_recorder, audio_packet_sink)))
enum sc_record_format {SC_RECORD_FORMAT_MP4, SC_RECORD_FORMAT_M4A,
    SC_RECORD_FORMAT_AAC, SC_RECORD_FORMAT_MKV, SC_RECORD_FORMAT_MKA,
    SC_RECORD_FORMAT_OPUS, SC_RECORD_FORMAT_FLAC, SC_RECORD_FORMAT_WAV};
enum sc_orientation {SC_ORIENTATION_0};
typedef struct {int unused;} sc_mutex;
typedef struct {int unused;} sc_cond;
typedef struct {int unused;} sc_thread;
typedef struct {int unused;} AVPacket;
typedef struct {int unused;} AVCodecParameters;
typedef struct {const char *name;} AVOutputFormat;
typedef struct {void *codec; int codec_id;} AVCodecContext;
typedef struct {int index; AVCodecParameters *codecpar;} AVStream;
typedef struct {void *pb; AVOutputFormat *oformat; void *metadata;} AVFormatContext;
struct sc_packet_sink;
struct sc_packet_sink_ops {
    bool (*open)(struct sc_packet_sink *, AVCodecContext *);
    void (*close)(struct sc_packet_sink *);
    bool (*push)(struct sc_packet_sink *, const AVPacket *);
    void (*disable)(struct sc_packet_sink *);
};
struct sc_packet_sink {const struct sc_packet_sink_ops *ops;};
struct sc_recorder_stream {int index; int64_t last_pts;};
struct sc_recorder_callbacks;
struct sc_recorder {
    struct sc_packet_sink video_packet_sink, audio_packet_sink;
    bool audio, video;
    enum sc_orientation orientation;
    char *filename;
    enum sc_record_format format;
    AVFormatContext *ctx;
    sc_thread thread;
    sc_mutex mutex;
    sc_cond cond;
    bool stopped;
    int video_queue, audio_queue;
    bool video_init, audio_init, audio_expects_config_packet;
    struct sc_recorder_stream video_stream, audio_stream;
    const struct sc_recorder_callbacks *cbs;
    void *cbs_userdata;
};
struct sc_recorder_callbacks {
    void (*on_ended)(struct sc_recorder *, bool, void *);
};
static int allocations, frees, opened, closed, invalid_streams, streams, creates;
static int mutex_depth;
static bool fail_create, fail_file, late_audio, ended;
static AVFormatContext context;
static AVStream stream_storage[2];
static AVCodecParameters parameters[2];
static int (*scheduled)(void *);
static void *scheduled_data;
static bool sc_orientation_is_mirror(enum sc_orientation o) {return false;}
static const char *sc_orientation_get_name(enum sc_orientation o) {return "0";}
static bool sc_recorder_set_orientation(AVStream *s, enum sc_orientation o) {return true;}
static bool sc_mutex_init(sc_mutex *m) {return true;}
static bool sc_cond_init(sc_cond *c) {return true;}
static void sc_mutex_destroy(sc_mutex *m) {(void)m;}
static void sc_mutex_lock(sc_mutex *m) {assert(mutex_depth++ == 0);}
static void sc_mutex_unlock(sc_mutex *m) {assert(--mutex_depth == 0);}
static void sc_cond_signal(sc_cond *c) {(void)c;}
static void sc_vecdeque_init(int *q) {*q = 0;}
static void sc_recorder_queue_clear(int *q) {*q = 0;}
static bool sc_thread_set_priority(int p) {return true;}
static bool sc_thread_create(sc_thread *t, int (*fn)(void *), const char *name, void *data) {
    ++creates;
    if (fail_create) return false;
    scheduled = fn;
    scheduled_data = data;
    return true;
}
static const AVOutputFormat *av_muxer_iterate(void **o) {
    static const AVOutputFormat format = {"mp4"};
    return &format;
}
static bool sc_str_list_contains(const char *s, char sep, const char *name) {return true;}
static char *sc_str_concat(const char *a, const char *b) {
    size_t n = strlen(a) + strlen(b) + 1;
    char *result = malloc(n);
    if (result) snprintf(result, n, "%s%s", a, b);
    return result;
}
static AVFormatContext *avformat_alloc_context(void) {
    assert(allocations == frees);
    ++allocations;
    memset(&context, 0, sizeof(context));
    return &context;
}
static void avformat_free_context(AVFormatContext *c) {
    assert(c == &context && allocations == frees + 1);
    ++frees;
}
static int avio_open(void **pb, const char *url, int flags) {
    if (fail_file) return -1;
    *pb = &opened;
    ++opened;
    return 0;
}
static int avio_close(void *pb) {assert(pb == &opened); ++closed; return 0;}
static int av_dict_set(void **m, const char *k, const char *v, int flags) {return 0;}
static AVStream *avformat_new_stream(AVFormatContext *c, const void *codec) {
    if (c != &context || allocations != frees + 1) {
        ++invalid_streams;
        return NULL;
    }
    assert(streams < 2);
    AVStream *s = &stream_storage[streams];
    s->index = streams;
    s->codecpar = &parameters[streams++];
    return s;
}
static int avcodec_parameters_from_context(AVCodecParameters *p, AVCodecContext *c) {return 0;}
static void sc_recorder_video_packet_sink_close(struct sc_packet_sink *s) {(void)s;}
static void sc_recorder_audio_packet_sink_close(struct sc_packet_sink *s) {(void)s;}
static void sc_recorder_audio_packet_sink_disable(struct sc_packet_sink *s) {(void)s;}
static bool sc_recorder_video_packet_sink_push(struct sc_packet_sink *s, const AVPacket *p) {return true;}
static bool sc_recorder_audio_packet_sink_push(struct sc_packet_sink *s, const AVPacket *p) {return true;}
static bool sc_recorder_process_packets(struct sc_recorder *r);
static bool sc_recorder_video_packet_sink_open(struct sc_packet_sink *, AVCodecContext *);
static bool sc_recorder_audio_packet_sink_open(struct sc_packet_sink *, AVCodecContext *);
static const AVOutputFormat *find_muxer(const char *name) {
    void *o = NULL;
    return av_muxer_iterate(&o);
}
/* ACTUAL_UPSTREAM_FUNCTIONS */
static void on_ended(struct sc_recorder *r, bool success, void *data) {ended = true;}
static bool sc_recorder_process_packets(struct sc_recorder *r) {
    AVCodecContext codec = {.codec_id = AV_CODEC_ID_PCM_S16LE};
    if (late_audio) {
        /* Valid one-open sequence: stop before the audio producer's first open.
         * A worker waiting for the first config is allowed to see stop here. */
        sc_recorder_stop(r);
        bool accepted = r->audio_packet_sink.ops->open(&r->audio_packet_sink, &codec);
        if (accepted) {fputs("FAIL: stopped recorder accepted first late audio sink\n", stderr); exit(10);}
    } else {
        assert(r->video_packet_sink.ops->open(&r->video_packet_sink, &codec));
        assert(r->audio_packet_sink.ops->open(&r->audio_packet_sink, &codec));
        sc_recorder_stop(r);
    }
    return true;
}
int main(int argc, char **argv) {
    assert(argc == 2);
    struct sc_recorder r;
    memset(&r, 0x2a, sizeof(r)); /* same conspicuous uninitialized ctx category */
    static const struct sc_recorder_callbacks cbs = {.on_ended = on_ended};
    assert(sc_recorder_init(&r, "owned-test.mp4", SC_RECORD_FORMAT_MP4,
                            true, true, SC_ORIENTATION_0, &cbs, NULL));
    fail_create = !strcmp(argv[1], "thread-failure");
    fail_file = !strcmp(argv[1], "file-failure");
    late_audio = !strcmp(argv[1], "late-audio");
    bool started = sc_recorder_start(&r);
    if (fail_create || fail_file) {
        assert(!started);
        assert(r.ctx == NULL);
        assert(allocations == 1 && frees == 1);
        assert(creates == (fail_file ? 0 : 1));
        assert(closed == (fail_file ? 0 : 1));
    } else if (!strcmp(argv[1], "start-before-worker")) {
        /* No worker has executed; start must publish a usable ctx already. */
        assert(started && scheduled);
        AVCodecContext codec = {0};
        bool accepted = r.video_packet_sink.ops->open(&r.video_packet_sink, &codec);
        if (!accepted || invalid_streams) {
            fputs("FAIL: start returned before output context initialization\n", stderr);
            return 11;
        }
        sc_recorder_stop(&r);
        sc_recorder_close_output_file(&r);
    } else {
        assert(started && scheduled);
        assert(scheduled(scheduled_data) == 0 && ended);
        assert(allocations == 1 && frees == 1 && opened == 1 && closed == 1);
        assert(streams == (late_audio ? 0 : 2));
    }
    assert(!invalid_streams && mutex_depth == 0);
    free(r.filename);
    puts("PASS: actual upstream recorder lifecycle");
    return 0;
}
