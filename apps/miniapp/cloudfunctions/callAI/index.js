// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  try {
    // 转发请求到 cozeAPIv2 云函数
    const result = await cloud.callFunction({
      name: 'cozeAPIv2',
      data: {
        ...event,
        openid: wxContext.OPENID
      }
    })
    
    return result.result
  } catch (error) {
    console.error('调用 cozeAPIv2 失败:', error)
    return {
      success: false,
      error: error.message || '调用AI服务失败'
    }
  }
} 