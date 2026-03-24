// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数 - 用于删除文章
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  // 检查权限（可以根据实际情况自定义）
  // 例如：只允许管理员删除文章
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
        message: '权限不足，只有管理员可以删除文章'
      }
    }
    
    // 获取要删除的文章ID
    const { id } = event
    
    if (!id) {
      return {
        success: false,
        message: '文章ID不能为空'
      }
    }
    
    // 查询文章信息（可选，用于返回删除的文章信息）
    const article = await db.collection('articles').doc(id).get()
    
    // 如果文章有封面图，且是云存储中的图片，则删除图片（避免资源浪费）
    if (article.data && article.data.cover && article.data.cover.startsWith('cloud://')) {
      try {
        await cloud.deleteFile({
          fileList: [article.data.cover]
        })
        console.log('删除文章封面成功:', article.data.cover)
      } catch (fileError) {
        console.error('删除文章封面失败:', fileError)
        // 这里不影响后续操作，继续删除文章
      }
    }
    
    // 删除文章
    await db.collection('articles').doc(id).remove()
    
    // 返回成功结果
    return {
      success: true,
      message: '文章删除成功',
      data: article.data || { _id: id }
    }
  } catch (error) {
    console.error('删除文章失败:', error)
    
    // 返回错误信息
    return {
      success: false,
      message: '删除文章失败: ' + error.message,
      error
    }
  }
} 