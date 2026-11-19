'use strict';
// 已准入评论使用同一视频的持久化转写；不重新转写或调用模型。
async function readScoreTranscript(client,lineKey,row,completedVideos){
 const videos=completedVideos.length===1?completedVideos:(await client.query(
  'SELECT video_url,title,transcript FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_url=$2',
  [lineKey,row.source_video_url])).rows;
 if(videos.length!==1||videos[0].video_url!==row.source_video_url||videos[0].title!==row.source_video)
  throw Error('POLICY_VIDEO_CONTEXT_INVALID');
 const transcript=videos[0].transcript;
 if(transcript!=null&&typeof transcript!=='string')throw Error('POLICY_VIDEO_TRANSCRIPT_INVALID');
 // 未曾持久化的转写明确缺省，不把标题伪装成转写。
 return transcript??null;
}
module.exports={readScoreTranscript};
