import test from 'node:test';
import assert from 'node:assert/strict';
import {locateStandaloneCommentProfile} from '../standalone-comment-observer.mjs';

test('102 每条评论先退出面板取主页链接，再退出原面板核实视频',async()=>{
  const calls=[];
  const result=await locateStandaloneCommentProfile({
    leaveCommentPanel:async stage=>{calls.push('leave:'+stage);return {ui:stage};},
    verifyProfileLink:async()=>{calls.push('profile-link');return {profile_url:'https://v.douyin.com/test/'};},
    verifyCurrentVideo:async()=>{calls.push('after-card-video');return {video_id:'1234567890123456789'};},
  });
  assert.deepEqual(calls,['leave:before-card','profile-link','leave:after-card','after-card-video']);
  assert.equal(result.profile.profile_url,'https://v.douyin.com/test/');
  assert.equal(result.video.video_id,'1234567890123456789');
  assert.deepEqual(result.details,[{ui:'before-card'},{ui:'after-card'}]);
});

test('102 退出评论面板证据失效时不执行下一次取链',async()=>{
  for(const blocked of ['before-card','after-card']){
    const calls=[];
    await assert.rejects(locateStandaloneCommentProfile({
      leaveCommentPanel:async stage=>{calls.push(stage);if(stage===blocked)throw Error('COMMENT_DETAIL_UNVERIFIED');},
      verifyProfileLink:async()=>{calls.push('profile-link');},
      verifyCurrentVideo:async()=>assert.fail('无详情证据不能取链接'),
    }),/COMMENT_DETAIL_UNVERIFIED/);
    assert.deepEqual(calls,blocked==='before-card'?['before-card']:['before-card','profile-link','after-card']);
  }
});
