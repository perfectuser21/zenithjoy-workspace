// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  try {
    const db = cloud.database()
    const userCollection = db.collection('users')
    
    // 查询用户是否存在
    const user = await userCollection.where({
      openid: openid
    }).get()
    
    // 如果用户不存在，创建新用户
    if (user.data.length === 0) {
      // 获取用户信息
      const userInfo = event.userInfo || {}
      
      // 创建用户记录
      const result = await userCollection.add({
        data: {
          openid: openid,
          nickName: userInfo.nickName || '',
          avatarUrl: userInfo.avatarUrl || '',
          gender: userInfo.gender || 0,
          country: userInfo.country || '',
          province: userInfo.province || '',
          city: userInfo.city || '',
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })
      
      return {
        success: true,
        isNew: true,
        userId: result._id,
        openid: openid
      }
    } else {
      // 用户已存在，更新信息
      const userId = user.data[0]._id
      
      // 如果有新的用户信息，则更新
      if (event.userInfo) {
        await userCollection.doc(userId).update({
          data: {
            nickName: event.userInfo.nickName,
            avatarUrl: event.userInfo.avatarUrl,
            gender: event.userInfo.gender,
            country: event.userInfo.country,
            province: event.userInfo.province,
            city: event.userInfo.city,
            updated_at: db.serverDate()
          }
        })
      }
      
      return {
        success: true,
        isNew: false,
        userId: userId,
        openid: openid,
        userInfo: user.data[0]
      }
    }
  } catch (error) {
    console.error('用户登录错误:', error)
    return {
      success: false,
      error: error.message
    }
  }
} 