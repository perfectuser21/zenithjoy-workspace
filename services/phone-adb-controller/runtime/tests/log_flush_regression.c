/* Real scrcpy logger, redirected to a regular file by the Python test.
 * Removing the output flush must make readiness invisible until exit. */
#include <stdio.h>
#include "util/log.h"

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    sc_log_configure();
    sc_set_log_level(SC_LOG_LEVEL_INFO);
    LOGI("Recording started to wav file: %s", argv[1]);
    /* Separate stderr proves the logger call returned, while stdout remains
     * a normal fully buffered regular file. No sleeps or forced process exit. */
    fputs("logger returned\n", stderr);
    fflush(stderr);
    return getchar() == '\n' ? 0 : 3;
}
