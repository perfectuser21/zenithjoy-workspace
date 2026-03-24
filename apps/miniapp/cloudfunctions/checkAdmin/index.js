// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  // 管理员OpenID列表
  const adminOpenIds = [
    'o2lLz62X0iyQEYcpnS2ljUvXlHF0', // 示例管理员ID，请替换为实际管理员的OpenID
  ]
  
  // 检查当前用户是否为管理员
  const isAdmin = adminOpenIds.includes(openid)
  
  return {
    isAdmin: isAdmin,
    openid: openid
  }
} 