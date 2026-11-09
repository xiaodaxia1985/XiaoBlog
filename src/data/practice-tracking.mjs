// 90 天实践追踪看板（网站 /90-days/ 页展示）
// =====================================================
// 后续更新方式：
// 1. 每天完成后，在 steps 数组最前面（或按日期顺序）追加一条记录；
// 2. 同步把 updatedAt 改成当天日期；
// 3. 若验收口径有变化，再改 acceptance；
// 4. 收入披露请保持“只写有没有收入 / 是否接近目标”，不公开具体金额与成本。
// =====================================================
export const tracking = {
  period: '2026.11.08 — 2027.02.05',
  updatedAt: '2026.11.09',
  incomeDisclosure: '收入只按“是否产生收入 / 是否接近目标”披露，不公开具体金额与成本。',
  acceptance: {
    content: { value: '6 篇', label: '前 14 天公开内容目标' },
    feedback: { value: '5 条', label: '前 14 天有效用户反馈目标' },
    paidUsers: { value: '1–3 位', label: '30 天累计付费用户目标' },
    monthlyIncome: { value: '¥4,000/月', label: '90 天争取达到的月收入目标' },
  },
  // 按日期追加：date / title / summary / deliverables / status(done|todo)
  steps: [
    {
      date: '2026.11.08',
      title: '确定 90 天实践框架并公开承诺',
      summary: '以品牌表达与品牌宣言为基础，确定四阶段路线，从信息消费者到商业创造者。',
      deliverables: [
        '品牌表达系统 V1',
        '品牌宣言 V1',
      ],
      status: 'done',
    },
    {
      date: '2026.11.09',
      title: '上线个人网站与 90 天追踪入口',
      summary: '把静态站部署到自购域名，跑通低成本上线路径；在 90 天页接入可追踪看板。',
      deliverables: [
        'xiaomaker.top 上线',
        '90 天追踪看板 v1',
      ],
      status: 'done',
    },
    {
      date: '2026.11.10',
      title: '内容系统与用户触达开闸',
      summary: '确定栏目与选题，建立内容日历；准备候选名单并发出首批触达。',
      deliverables: [
        '内容日历 v1',
        '候选名单与触达话术',
      ],
      status: 'todo',
    },
    {
      date: '2026.11.11',
      title: '发布品牌宣言',
      summary: '三渠道发布：博客首篇、小红书首篇、公众号首篇，并记录发布数据。',
      deliverables: [
        '博客 / 小红书 / 公众号首发',
      ],
      status: 'todo',
    },
    {
      date: '2026.11.12',
      title: '公开 90 天实践计划',
      summary: '把 90 天页整理为可对外公开的计划与进度记录，补齐日志与数据表。',
      deliverables: [
        '90 天计划公开页',
        '进度日志 Day 01–05',
      ],
      status: 'todo',
    },
    {
      date: '2026.11.13',
      title: '目标用户研究收口',
      summary: '完成 10 个真实案例与问题矩阵，留出 Day 07 方向对比所需证据。',
      deliverables: [
        '目标用户案例 10 例',
        '问题与替代方案矩阵',
      ],
      status: 'todo',
    },
  ],
};

