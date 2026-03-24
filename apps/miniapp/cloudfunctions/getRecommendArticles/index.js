// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  // 返回空数组，不再获取任何文章
  return {
    success: true,
    data: [],
    message: "文章功能已禁用",
    total: 0
  }
}

// 格式化日期函数
function formatDate(dateTime) {
  if (!dateTime) return ''
  
  const date = new Date(dateTime)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  
  return `${year}-${month}-${day}`
}

// 获取备用文章数据
function getBackupArticles(limit) {
  return [
    {
      id: 'article1',
      title: '如何充分利用AI智能助手提升工作效率',
      desc: '本文将介绍如何使用AI智能助手处理日常任务，从创作内容到生成图片，从回答问题到提供专业建议，全方位提升您的工作效率。',
      cover: '/images/default-cover.png',
      date: '2024-03-15',
      tags: ['AI助手', '效率提升']
    },
    {
      id: 'article2',
      title: 'AI内容创作的最佳实践与技巧',
      desc: '探索如何通过合理的提示词设计，获得高质量的AI生成内容，包括文案、故事、报告和技术文档等各类内容的创作技巧。',
      cover: '/images/default-cover.png',
      date: '2024-03-10',
      tags: ['AI创作', '内容生成']
    },
    {
      id: 'article3',
      title: 'AI图像生成：从入门到精通',
      desc: '本文介绍如何使用AI图像生成工具创建各种类型的图像，从风景到人物，从插图到设计元素，帮助您实现创意想法。',
      cover: '/images/default-cover.png',
      date: '2024-03-05',
      tags: ['AI绘画', '创意设计']
    },
    {
      id: 'article4',
      title: '小程序开发中的AI应用场景',
      desc: '探索AI技术在小程序开发中的各种应用场景，包括智能客服、内容推荐、图像处理和用户体验优化等方面。',
      cover: '/images/default-cover.png',
      date: '2024-02-28',
      tags: ['小程序', 'AI应用']
    },
    {
      id: 'article5',
      title: '2024年AI技术趋势展望',
      desc: '分析2024年AI技术发展的主要趋势，包括大型语言模型、多模态AI、AI伦理和隐私保护，以及对各行业的影响。',
      cover: '/images/default-cover.png',
      date: '2024-02-20',
      tags: ['AI趋势', '技术前沿']
    }
  ].slice(0, limit);
} 