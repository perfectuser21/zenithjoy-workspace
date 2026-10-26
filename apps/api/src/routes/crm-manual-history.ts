import { Router, type Request, type Response, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db/connection';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';
import { ManualHistoryService, ManualHistoryError, type ManualDb, type ManualGenerate, type ManualScope } from '../services/crm/manual-history';

interface Dependencies { db?:ManualDb;generate?:ManualGenerate;authenticate?:RequestHandler;now?:()=>number }
/** This human-confirmed import endpoint accepts a real login cookie, never legacy header identities. */
function sessionAuthentication(db:ManualDb):RequestHandler{
 return (req,res,next)=>{
  if(typeof req.headers.cookie!=='string'||!req.headers.cookie.trim()){
   res.status(401).json({error:{code:'UNAUTHORIZED',message:'请登录客户后台后补录'}});return;
  }
  void (async()=>{
   // Pass only the cookie to Better Auth: Bearer/Feishu/admin/bypass headers are not identities here.
   const session=await auth.api.getSession({headers:fromNodeHeaders({cookie:req.headers.cookie})});
   const actor=session?.user?.id;
   if(typeof actor!=='string'||!actor){res.status(401).json({error:{code:'UNAUTHORIZED',message:'登录已失效，请重新登录'}});return;}
   const member=await db.query(`SELECT tenant_id,role FROM zenithjoy.tenant_members WHERE feishu_user_id=$1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,created_at ASC LIMIT 1`,[actor]);
   if(!member.rows.length){res.status(403).json({error:{code:'NO_TENANT',message:'当前账号未关联客户组织'}});return;}
   req.tenantId=member.rows[0].tenant_id;req.tenantRole=member.rows[0].role;req.feishuUserId=actor;next();
  })().catch(()=>{res.status(503).json({error:{code:'AUTH_UNAVAILABLE',message:'登录验证暂时不可用，请重试'}});});
 };
}
/** Injectable authentication is for isolated tests; the production default is strict session authentication. */
export function createManualHistoryRouter({db=pool,generate,authenticate,now}:Dependencies={}){
 const router=Router(),service=new ManualHistoryService(db,generate,now);
 router.use(authenticate??sessionAuthentication(db));
 const rateKey=(req:Request)=>`${req.tenantId??'none'}:${req.feishuUserId??'anonymous'}`;
 const limitMessage={error:{code:'IMPORT_RATE_LIMIT',message:'操作较频繁，请稍后再试'}};
 router.use(rateLimit({windowMs:60000,limit:120,keyGenerator:rateKey,message:limitMessage,standardHeaders:'draft-7',legacyHeaders:false}));
 const previewLimit=rateLimit({windowMs:60000,limit:20,keyGenerator:rateKey,message:limitMessage,standardHeaders:'draft-7',legacyHeaders:false});
 async function scope(req:Request,write=false):Promise<ManualScope>{
  if(!req.tenantId||!req.feishuUserId)throw new ManualHistoryError('UNAUTHORIZED',401,'请登录客户后台后补录');
  if(write&&!['owner','admin'].includes(req.tenantRole??''))throw new ManualHistoryError('NOT_ADMIN',403,'仅管理员可补录聊天记录');
  const source=req.method==='GET'?req.query:req.body;
  const customerId=source?.customer_id,csWechatId=source?.cs_wechat_id;
  if(typeof customerId!=='string'||!/^\d{1,19}$/.test(customerId)||BigInt(customerId)<1n||BigInt(customerId)>9223372036854775807n||typeof csWechatId!=='string'||!csWechatId.trim()||csWechatId.length>300)throw new ManualHistoryError('CRM_TARGET_REQUIRED');
  const checked=await db.query(`SELECT c.id FROM zenithjoy.crm_customers c JOIN zenithjoy.service_agents a ON a.tenant_id=c.tenant_id AND a.wechat_id=c.cs_wechat_id AND a.deleted_at IS NULL WHERE c.tenant_id=$1::uuid AND c.cs_wechat_id=$2 AND c.id=$3::bigint AND c.deleted_at IS NULL LIMIT 1`,[req.tenantId,csWechatId,customerId]);
  if(!checked.rows.length)throw new ManualHistoryError('CUSTOMER_NOT_FOUND',404,'客户或微信账号不可访问');
  return {tenantId:req.tenantId,csWechatId,customerId:String(checked.rows[0].id),actor:req.feishuUserId};
 }
 const handle=(action:(req:Request,res:Response)=>Promise<unknown>):RequestHandler=>(req,res)=>{
  void action(req,res).catch((error:unknown)=>{
   // Do not log arbitrary SQL/model errors: those may echo the source material.
   if(error instanceof ManualHistoryError)return res.status(error.status).json({error:{code:error.code,message:error.message}});
   return res.status(500).json({error:{code:'MANUAL_HISTORY_FAILED',message:'补录暂时失败，请保留输入后重试'}});
  });
 };
 router.post('/preview',previewLimit,handle(async(req,res)=>{
  const target=await scope(req,true),body=req.body??{};
  if(Object.keys(body).some(k=>!['customer_id','cs_wechat_id','source_type','channel_name','source_account','text'].includes(k)))throw new ManualHistoryError('UNKNOWN_PREVIEW_FIELDS');
  const material={source_type:body.source_type,channel_name:body.channel_name,source_account:body.source_account,text:body.text};
  return res.json({preview:await service.preview(target,material)});
 }));
 router.post('/commit',handle(async(req,res)=>{
  const target=await scope(req,true),body=req.body??{};
  if(Object.keys(body).some(k=>!['customer_id','cs_wechat_id','preview_id','preview_version','request_id','confirmed_result'].includes(k)))throw new ManualHistoryError('UNKNOWN_COMMIT_FIELDS');
  return res.json(await service.commit(target,body));
 }));
 router.get('/requests/:requestId',handle(async(req,res)=>res.json({record:await service.readRequest(await scope(req),req.params.requestId)})));
 router.get('/',handle(async(req,res)=>res.json({records:await service.list(await scope(req))})));
 router.get('/:id',handle(async(req,res)=>res.json({record:await service.read(await scope(req),req.params.id)})));
 return router;
}
export default createManualHistoryRouter();
