// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  console.log('获取手机号请求参数:', event)
  
  try {
    // 获取微信手机号
    const { cloudID } = event
    
    if (!cloudID) {
      return {
        success: false,
        message: '缺少cloudID参数'
      }
    }
    
    // 解析手机号
    const phoneRes = await cloud.getOpenData({
      list: [cloudID]
    })
    
    console.log('解析手机号成功:', phoneRes)
    
    // 从返回结果中提取手机号
    if (!phoneRes.list || !phoneRes.list[0] || !phoneRes.list[0].data) {
      return {
        success: false,
        message: '无法获取手机号信息'
      }
    }
    
    const phoneInfo = phoneRes.list[0].data
    
    // 检查手机号是否存在
    if (!phoneInfo.phoneNumber) {
      return {
        success: false,
        message: '未获取到有效手机号'
      }
    }
    
    const phoneNumber = phoneInfo.phoneNumber
    const countryCode = phoneInfo.countryCode || '+86'
    const purePhoneNumber = phoneInfo.purePhoneNumber || phoneNumber
    
    // 更新用户信息
    try {
      // 检查用户是否存在
      const userRes = await db.collection('users').where({
        _openid: openid
      }).get()
      
      if (userRes.data && userRes.data.length > 0) {
        // 用户存在，更新手机号
        const userId = userRes.data[0]._id
        await db.collection('users').doc(userId).update({
          data: {
            phoneNumber: phoneNumber,
            purePhoneNumber: purePhoneNumber,
            countryCode: countryCode,
            updatedAt: db.serverDate()
          }
        })
      } else {
        // 用户不存在，创建新用户
        await db.collection('users').add({
          data: {
            _openid: openid,
            phoneNumber: phoneNumber,
            purePhoneNumber: purePhoneNumber,
            countryCode: countryCode,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
      }
      
      return {
        success: true,
        phoneNumber: phoneNumber,
        purePhoneNumber: purePhoneNumber,
        countryCode: countryCode
      }
    } catch (dbError) {
      console.error('更新用户数据库失败:', dbError)
      return {
        success: true, // 仍然返回成功，因为获取手机号成功
        phoneNumber: phoneNumber,
        purePhoneNumber: purePhoneNumber,
        countryCode: countryCode,
        dbError: dbError.message
      }
    }
  } catch (error) {
    console.error('获取手机号失败:', error)
    return {
      success: false,
      message: '获取手机号失败: ' + error.message
    }
  }
} 