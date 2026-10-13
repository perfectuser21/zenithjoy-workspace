// 仅测试注入的公司版本；生产入口没有默认画像。
export const scoringRules={criteria:{A:'主动报名',B:'咨询',C:'互动','不相关':'跑题'},confidence_threshold:.6};
export const companyFixture=(key='jinuo')=>({company_id:`fake-${key}`,tenant_id:`tenant-${key}`,company_key:key,version:1,wiki:{products:['测试产品'],audiences:['测试人群'],customer_portrait:`测试画像-${key}`},runtime_config:{video_judgment:{instructions:'测试判断规则'},comment_scoring:scoringRules,search_strategy:{keywords:['测试关键词']}},product_ids:['product-test'],policy_id:'policy-test'});
export const freezeFixture=async(_pool,{lineHint})=>companyFixture(String(lineHint).includes('yuesheng')?'yuesheng':'jinuo');

export function withCompanyFixture(createHandlers) {
  return options => createHandlers({...options,rpc:async body=>{
    if(body.request?.op==='company_config')return {result:{company_id:'fake-jinuo',tenant_id:'tenant-jinuo',version:1,policy_id:'policy-test'}};
    const response=await options.rpc(body);
    if(['claim_videos','inspect_videos'].includes(body.request?.op)&&Array.isArray(response?.result)) {
      return {...response,result:response.result.map(row=>({...row,judgment_config:row.judgment_config??{company_id:'fake-jinuo',version:1}}))};
    }
    return response;
  }});
}
