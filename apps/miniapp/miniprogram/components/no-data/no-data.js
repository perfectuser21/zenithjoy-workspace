Component({
  /**
   * 组件的属性列表
   */
  properties: {
    text: {
      type: String,
      value: '暂无数据'
    },
    subText: {
      type: String,
      value: ''
    },
    icon: {
      type: String,
      value: 'warn'
    },
    buttonText: {
      type: String,
      value: ''
    },
    showButton: {
      type: Boolean,
      value: false
    }
  },

  /**
   * 组件的初始数据
   */
  data: {

  },

  /**
   * 组件的方法列表
   */
  methods: {
    handleButtonTap() {
      this.triggerEvent('buttonTap')
    }
  }
}) 