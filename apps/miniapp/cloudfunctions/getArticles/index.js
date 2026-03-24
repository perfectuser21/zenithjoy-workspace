// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const articlesCollection = db.collection('articles')
const MAX_LIMIT = 100

// 云函数入口函数
exports.main = async (event, context) => {
  const { page = 1, pageSize = 10, tag } = event
  const skip = (page - 1) * pageSize
  
  try {
    let query = articlesCollection.orderBy('createTime', 'desc')
    
    // 如果有标签筛选
    if (tag) {
      query = query.where({
        tags: db.command.all([tag])
      })
    }
    
    // 获取文章总数
    const countResult = await query.count()
    const total = countResult.total
    
    // 获取文章列表
    const articlesRes = await query.skip(skip).limit(pageSize).get()
    
    // 如果数据库中没有文章，返回示例数据
    if (total === 0) {
      return {
        success: true,
        data: getMockArticles(),
        total: 3,
        page,
        pageSize
      }
    }
    
    return {
      success: true,
      data: articlesRes.data,
      total,
      page,
      pageSize
    }
  } catch (err) {
    console.error('获取文章列表失败', err)
    
    // 如果发生错误，返回示例数据
    return {
      success: true,
      data: getMockArticles(),
      total: 3,
      page,
      pageSize,
      isMock: true
    }
  }
}

// 获取模拟文章数据
function getMockArticles() {
  return [
    {
      _id: 'article1',
      title: 'AI技术在日常生活中的应用',
      content: '随着人工智能技术的快速发展，AI已经深入到我们生活的方方面面。从智能手机到智能家居，从个人助手到自动驾驶汽车，AI正在改变我们的生活方式...',
      cover: '/images/article-cover1.png',
      summary: '探索AI如何改变我们的日常生活，从智能手机到智能家居，AI无处不在。',
      date: '2024-01-20',
      createTime: new Date('2024-01-20'),
      author: 'AI技术团队',
      viewCount: 256,
      tags: ['AI应用', '生活科技']
    },
    {
      _id: 'article2',
      title: '大语言模型：未来的交流方式',
      content: '大语言模型正在彻底改变人机交互的方式。通过自然语言处理技术，计算机现在能够理解和生成人类语言，使交流更加自然和高效...',
      cover: '/images/article-cover2.png',
      summary: '大语言模型如何改变人机交互，使计算机能够理解和生成人类语言。',
      date: '2024-01-15',
      createTime: new Date('2024-01-15'),
      author: '语言技术研究所',
      viewCount: 189,
      tags: ['大语言模型', 'NLP技术']
    },
    {
      _id: 'article3',
      title: '如何利用AI提升工作效率',
      content: '人工智能工具可以帮助我们自动化重复性任务，提高工作效率。从智能邮件分类到自动化报告生成，AI正在成为现代职场的得力助手...',
      cover: '/images/article-cover3.png',
      summary: '探索如何利用AI工具自动化重复性任务，提高工作效率。',
      date: '2024-01-10',
      createTime: new Date('2024-01-10'),
      author: '职场效率专家',
      viewCount: 321,
      tags: ['工作效率', 'AI工具']
    }
  ]
}