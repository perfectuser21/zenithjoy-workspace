// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  if (!openid) {
    return {
      success: false,
      code: 'NO_OPENID',
      message: '无法获取用户身份'
    }
  }
  
  try {
    // 查询用户信息
    let userInfo = await db.collection('users').where({
      openid: openid
    }).get()
    
    // 用户不存在则创建
    if (userInfo.data.length === 0) {
      await db.collection('users').add({
        data: {
          openid: openid,
          createTime: db.serverDate(),
          updateTime: db.serverDate(),
          lastLoginTime: db.serverDate(),
          usageCount: 0
        }
      })
      
      userInfo = {
        data: [{
          openid: openid,
          createTime: new Date(),
          updateTime: new Date(),
          lastLoginTime: new Date(),
          usageCount: 0
        }]
      }
    } else {
      // 更新最后登录时间
      await db.collection('users').where({ openid: openid }).update({
        data: {
          lastLoginTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      })
    }
    
    // 检查用户会员状态
    let membership = await db.collection('memberships').where({
      openid: openid,
      expireDate: _.gt(new Date()) // 未过期的会员
    }).orderBy('level', 'desc').limit(1).get()
    
    // 获取会员套餐详情
    let membershipPlan = null
    
    if (membership.data.length > 0) {
      const membershipData = membership.data[0]
      
      // 获取会员套餐详情
      const plans = await db.collection('membership_plans').where({
        id: membershipData.level
      }).get()
      
      if (plans.data.length > 0) {
        membershipPlan = plans.data[0]
      }
    } else {
      // 默认为免费会员
      const freePlan = await db.collection('membership_plans').where({
        id: 'free'
      }).get()
      
      if (freePlan.data.length > 0) {
        membershipPlan = freePlan.data[0]
        
        // 创建默认免费会员记录
        await db.collection('memberships').add({
          data: {
            openid: openid,
            level: 'free',
            name: '普通会员',
            expireDate: new Date(new Date().setFullYear(new Date().getFullYear() + 100)), // 设置很长的过期时间
            createTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        })
      }
    }
    
    // 获取当日使用次数
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const usageToday = await db.collection('chats')
      .where({
        _openid: openid,
        createTime: _.gte(today)
      })
      .count()
    
    return {
      success: true,
      data: {
        userInfo: userInfo.data[0],
        membership: membership.data.length > 0 ? membership.data[0] : { level: 'free', name: '普通会员' },
        membershipPlan: membershipPlan,
        usageToday: usageToday.total || 0,
        remainingQuota: membershipPlan && membershipPlan.dailyQuota > 0 
          ? Math.max(0, membershipPlan.dailyQuota - (usageToday.total || 0)) 
          : (membershipPlan && membershipPlan.dailyQuota === -1 ? -1 : 0) // -1 表示无限制
      }
    }
  } catch (error) {
    console.error('检查会员状态失败', error)
    return {
      success: false,
      code: 'CHECK_FAILED',
      message: '检查会员状态失败',
      error: error
    }
  }
} 