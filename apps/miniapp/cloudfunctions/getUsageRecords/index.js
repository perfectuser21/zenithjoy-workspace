// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

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
    // 获取过去7天的聊天记录
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    // 按日期分组聊天记录并统计
    const usageStats = await db.collection('chats')
      .aggregate()
      .match({
        _openid: openid,
        createTime: _.gte(sevenDaysAgo)
      })
      .addFields({
        dateStr: $.dateToString({
          date: '$createTime',
          format: '%Y-%m-%d'
        })
      })
      .group({
        _id: '$dateStr',
        count: $.sum(1)
      })
      .sort({
        _id: -1
      })
      .limit(7)
      .end()
    
    // 格式化结果
    const records = usageStats.list.map(item => ({
      time: item._id,
      count: item.count
    }))
    
    return {
      success: true,
      data: records
    }
  } catch (error) {
    console.error('获取使用记录失败', error)
    return {
      success: false,
      code: 'GET_USAGE_FAILED',
      message: '获取使用记录失败',
      error: error
    }
  }
} 