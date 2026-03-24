// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数 - 用于创建文章
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  // 检查权限（可以根据实际情况自定义）
  // 例如：只允许管理员添加文章
  const openId = wxContext.OPENID
  
  try {
    // 检查是否是管理员
    const adminCheck = await db.collection('admins').where({
      openId: openId
    }).get()
    
    // 如果不是管理员并且不是开发环境，则拒绝请求
    if (adminCheck.data.length === 0 && wxContext.ENV !== 'local') {
      return {
        success: false,
        message: '权限不足，只有管理员可以添加文章'
      }
    }
    
    // 获取文章数据
    const { title, desc, content, cover, tags } = event
    
    // 验证必填字段
    if (!title || !content) {
      return {
        success: false,
        message: '标题和内容为必填项'
      }
    }
    
    // 创建文章对象
    const articleData = {
      title,
      desc: desc || content.substring(0, 100), // 如果没有提供摘要，截取内容前100个字符
      content,
      cover: cover || '/images/default-cover.png', // 如果没有提供封面，使用默认图片
      tags: tags || ['AI资讯'],
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
      date: formatDate(new Date()), // 格式化后的日期字符串
      views: 0,
      likes: 0,
      author: event.author || '管理员',
      status: event.status || 'published' // 默认为已发布状态
    }
    
    // 添加到数据库
    const result = await db.collection('articles').add({
      data: articleData
    })
    
    // 返回成功结果
    return {
      success: true,
      message: '文章创建成功',
      data: {
        _id: result._id,
        ...articleData
      }
    }
  } catch (error) {
    console.error('创建文章失败:', error)
    
    // 返回错误信息
    return {
      success: false,
      message: '创建文章失败: ' + error.message,
      error
    }
  }
}

// 格式化日期为 YYYY-MM-DD 格式
function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
} 