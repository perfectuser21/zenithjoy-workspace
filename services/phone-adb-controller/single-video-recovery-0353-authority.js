'use strict';
const {createAuthority}=require('./single-video-recovery-authority.js');
const {SCOPE,RECOVERY_RUN}=require('./single-video-recovery-0353.js');
const proofs=Object.freeze({
 "root-0353-first-claim-PG-independent.json": "935acbe264ba726c0ba0830c09a265c3272e4792fdd4503ee554a74825aabab1",
 "failure-original.json": "53a197c6560ec544a1bb8865a945c039b6e5bd8e60dfb829ca1085029919bc27",
 "mmv-stop-proof.json": "b284baa4f8b02d829903edcdb5ca221e49bb2b93ac1fa105896363003c975ce2",
 "xian-stop-proof.json": "c5d067cba6e0ce5fb63b3f9dbcdeb36aab3750287bec07f67cfbfe9d200c218f",
 "central-free-readback.json": "a0f363aff636a6ab40ebb8728ddfefe1a417111e451ef5316b914d8a669f8371",
 "local-free-readback.txt": "77c2e2922f0ce42e6821c6c0a683a757699e74a0c1a1ab6fe8b555f0a7d88a73",
 "official-session.json": "a8e1d14662a0eab90cb9df2da8bd798308cf2e6213899595274f700d2a387f8d",
 "official-queue.json": "9955c8930804a6b11ee445fdee0933476f5b844b09cddd003bca0d7915c43147"
});
function authority(input){return createAuthority({}, {scope:SCOPE,decision:input.decision_id,run:RECOVERY_RUN,proofs,lockTextFile:'local-free-readback.txt',splitFile:'failure-original.json',splitContainer:'split-result.json',mmvProofFile:'mmv-stop-proof.json',xianProofFile:'xian-stop-proof.json',groupsFromNative:true,identityCount:61,session:'agent:work-commander:workflow-db19fd7415613f7bfa8fa06659478c1e',sessionId:'a5195822-9732-4723-bf3a-25b77e48009e'});}
module.exports={authority,proofs};
