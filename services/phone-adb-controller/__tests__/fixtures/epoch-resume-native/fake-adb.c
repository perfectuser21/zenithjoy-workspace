/* Offline smart-socket fixture. One nofork PID, loopback only, never a phone. */
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <signal.h>
#include <pthread.h>
#include <stdint.h>
#define ROOT "@ROOT@"
#define OLDPORT @OLDPORT@
#define NEWPORT @NEWPORT@
static int readn(int s,char*b,int n){int z=0,k;while(z<n&&(k=read(s,b+z,n-z))>0)z+=k;return z==n;}
static void emit(int s,const char*b,int n){while(n>0){int k=write(s,b,n);if(k<=0)return;b+=k;n-=k;}}
static void logline(const char*text){char p[4096];snprintf(p,sizeof(p),"%s/adb-events.log",ROOT);FILE*f=fopen(p,"a");struct timespec t;clock_gettime(CLOCK_REALTIME,&t);fprintf(f,"%ld.%09ld %d %s\n",t.tv_sec,t.tv_nsec,getpid(),text);fclose(f);}
static int request(int s,char*b){char h[5]={0};if(!readn(s,h,4))return 0;int n=(int)strtol(h,0,16);if(n<1||n>65535||!readn(s,b,n))return 0;b[n]=0;logline(b);return 1;}
static void reply(int s,const char*b){char h[9];snprintf(h,sizeof(h),"OKAY%04x",(unsigned)strlen(b));emit(s,h,8);emit(s,b,strlen(b));}
static void output(int s,const char*name){char p[4096],b[65536];snprintf(p,sizeof(p),"%s/sdk/%s.txt",ROOT,name);FILE*f=fopen(p,"rb");int n=f?fread(b,1,sizeof(b),f):0;if(f)fclose(f);unsigned char h[5]={1,n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255};emit(s,(char*)h,5);emit(s,b,n);char end[6]={3,1,0,0,0,0};emit(s,end,6);}
static int logical,connected;
static void*handle(void*value){int s=(int)(intptr_t)value;char b[65536];if(!request(s,b)){close(s);return 0;}if(!strcmp(b,"host:version"))reply(s,"0029");else if(!strcmp(b,"host:devices-l"))reply(s,logical==5042&&connected?"192.0.2.31:10001 device product:fixture\n":"");else if(!strncmp(b,"host:connect:",13)){connected=1;char fail[4096];snprintf(fail,sizeof(fail),"%s/drop-connect-ack",ROOT);if(access(fail,F_OK))reply(s,"connected to 192.0.2.31:10001");}else if(strstr(b,":features"))reply(s,"shell_v2");else if(!strncmp(b,"host:transport:",15)){emit(s,"OKAY",4);if(request(s,b)&&!strncmp(b,"shell,v2,raw:",13)){emit(s,"OKAY",4);char close_stdin[5];if(readn(s,close_stdin,5)){const char*name=strstr(b,"ro.build.version.sdk")?"sdk":strstr(b,"boot_id")?"boot_id":strstr(b,"ps -A")?"processes":strstr(b,"dumpsys input")?"input":strstr(b,"dumpsys activity")?"activity":"window";output(s,name);}}}else reply(s,"");shutdown(s,SHUT_WR);close(s);return 0;}
int main(int argc,char**argv){signal(SIGPIPE,SIG_IGN);if(argc==2&&!strcmp(argv[1],"version")){puts("Android Debug Bridge version 1.0.41");return 0;}if(argc!=5||strcmp(argv[1],"-L"))return 2;logical=atoi(argv[2]+4);int port=logical==5041?OLDPORT:logical==5042?NEWPORT:0;if(!port)return 2;int listener=socket(AF_INET,SOCK_STREAM,0),yes=1;setsockopt(listener,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof(yes));struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);a.sin_port=htons(port);if(bind(listener,(void*)&a,sizeof(a))||listen(listener,16))return 3;logline(logical==5041?"daemon-old-start":"daemon-private-start");for(;;){int s=accept(listener,0,0);if(s<0)continue;pthread_t thread;if(pthread_create(&thread,0,handle,(void*)(intptr_t)s))close(s);else pthread_detach(thread);} }
