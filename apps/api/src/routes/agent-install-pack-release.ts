import {Router} from 'express';
import {internalAuth} from '../middleware/internal-auth';
import {manifestState,verifyCandidate,installPackContract,publishCandidate,promoteCandidate,rollbackManifest} from '../services/install-pack-release';

export const installPackReleaseRouter=Router();
const manifestPath=()=>process.env.INSTALL_PACK_MANIFEST_PATH||'/opt/zenithjoy/install-pack/manifest.json';
installPackReleaseRouter.put('/manifest',internalAuth,(_req,res)=>{
 res.status(409).json({ok:false,code:'RELEASE_ADMISSION_REQUIRED',message:'使用候选登记和真实业务验收晋级接口'});
});
installPackReleaseRouter.get('/release-state',internalAuth,(_req,res)=>{res.json(manifestState(manifestPath()));});
installPackReleaseRouter.get('/release-contract',internalAuth,(_req,res)=>{res.json(installPackContract());});
installPackReleaseRouter.post('/candidates',internalAuth,(req,res)=>{
 try{res.status(201).json({ok:true,candidate:publishCandidate(manifestPath(),req.body)});}
 catch{res.status(400).json({ok:false,code:'CANDIDATE_REJECTED'});}
});
installPackReleaseRouter.post('/verify',internalAuth,async(req,res)=>{
 try{res.json({ok:true,...await verifyCandidate(manifestPath(),req.body)});}
 catch{res.status(409).json({ok:false,code:'RELEASE_NOT_ADMITTED'});}
});
installPackReleaseRouter.post('/promote',internalAuth,async(req,res)=>{
 try{res.json({ok:true,manifest:await promoteCandidate(manifestPath(),req.body)});}
 catch{res.status(409).json({ok:false,code:'RELEASE_NOT_ADMITTED'});}
});
installPackReleaseRouter.post('/rollback',internalAuth,(req,res)=>{
 try{res.json({ok:true,manifest:rollbackManifest(manifestPath(),req.body)});}
 catch{res.status(409).json({ok:false,code:'ROLLBACK_REJECTED'});}
});
