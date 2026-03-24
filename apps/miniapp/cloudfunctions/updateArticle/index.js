// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数 - 用于更新文章
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  // 检查权限（可以根据实际情况自定义）
  // 例如：只允许管理员更新文章
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
        message: '权限不足，只有管理员可以更新文章'
      }
    }
    
    // 获取要更新的文章ID
    const { id } = event
    
    if (!id) {
      return {
        success: false,
        message: '文章ID不能为空'
      }
    }
    
    // 查询原始文章信息
    const originalArticle = await db.collection('articles').doc(id).get()
    if (!originalArticle.data) {
      return {
        success: false,
        message: '文章不存在'
      }
    }
    
    // 准备更新的数据
    const { title, desc, content, cover, tags, author, status } = event
    
    // 验证必填字段
    if (!title || !content) {
      return {
        success: false,
        message: '标题和内容为必填项'
      }
    }
    
    // 如果封面图有更新，且原封面是云存储图片，则删除旧图片
    if (cover && cover !== originalArticle.data.cover && originalArticle.data.cover && originalArticle.data.cover.startsWith('cloud://')) {
      try {
        await cloud.deleteFile({
          fileList: [originalArticle.data.cover]
        })
        console.log('删除旧封面成功:', originalArticle.data.cover)
      } catch (fileError) {
        console.error('删除旧封面失败:', fileError)
        // 这里不影响后续操作，继续更新文章
      }
    }
    
    // 创建更新对象
    const updateData = {
      title,
      desc: desc || content.substring(0, 100), // 如果没有提供摘要，截取内容前100个字符
      content,
      updateTime: db.serverDate()
    }
    
    // 仅当有值时更新以下字段
    if (cover) updateData.cover = cover
    if (tags) updateData.tags = tags
    if (author) updateData.author = author
    if (status) updateData.status = status
    
    // 更新文章
    await db.collection('articles').doc(id).update({
      data: updateData
    })
    
    // 返回成功结果
    return {
      success: true,
      message: '文章更新成功',
      data: {
        _id: id,
        ...updateData
      }
    }
  } catch (error) {
    console.error('更新文章失败:', error)
    
    // 返回错误信息
    return {
      success: false,
      message: '更新文章失败: ' + error.message,
      error
    }
  }
} 