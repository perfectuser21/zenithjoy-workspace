// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  // 检查必要参数
  const { code } = event;
  
  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '无法获取用户身份'
    }
  }
  
  if (!code) {
    return {
      success: false,
      code: 'MISSING_CODE',
      message: '获取手机号码参数缺失'
    }
  }
  
  try {
    // 使用微信提供的接口获取用户手机号
    const result = await cloud.getOpenData({
      list: [code],
    });
    
    // 解析手机号
    const phoneNumber = result.list[0].data.phoneNumber;
    
    if (!phoneNumber) {
      return {
        success: false,
        code: 'DECODE_FAILED',
        message: '手机号解析失败'
      };
    }
    
    // 查询用户是否存在
    const userResult = await db.collection('users').where({
      openid: openid
    }).get()
    
    // 用户不存在则创建
    if (userResult.data.length === 0) {
      await db.collection('users').add({
        data: {
          openid: openid,
          phoneNumber: phoneNumber,
          createTime: db.serverDate(),
          updateTime: db.serverDate(),
          lastLoginTime: db.serverDate()
        }
      })
    } else {
      // 更新用户手机号
      await db.collection('users').where({
        openid: openid
      }).update({
        data: {
          phoneNumber: phoneNumber,
          updateTime: db.serverDate()
        }
      })
    }
    
    // 调用会员状态检查云函数
    const membershipResult = await cloud.callFunction({
      name: 'checkMembership'
    })
    
    return {
      success: true,
      message: '手机号更新成功',
      data: {
        phoneNumber: phoneNumber,
        membership: membershipResult.result.data
      }
    }
  } catch (error) {
    console.error('更新手机号失败', error)
    return {
      success: false,
      code: 'UPDATE_FAILED',
      message: '更新手机号失败',
      error: error
    }
  }
} 