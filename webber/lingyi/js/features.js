/* 轻量化独居老人大数据监护助手项目 - 项目特色页面JavaScript文件 */
/* 作者：XXX团队 创建时间：2026年 */

// 特色功能详情数据
const featureDetails = {
    monitoring: {
        title: '智能监测系统',
        content: `
            <div class="feature-detail">
                <div class="detail-header">
                    <div class="detail-icon">
                        <i class="fas fa-video"></i>
                    </div>
                    <div class="detail-info">
                        <h4>智能行为监测</h4>
                        <p>基于人工智能的实时行为分析系统</p>
                    </div>
                </div>
                
                <div class="detail-content">
                    <h5>核心功能</h5>
                    <ul>
                        <li><strong>实时活动追踪：</strong>24小时不间断监测老人日常活动</li>
                        <li><strong>行为模式识别：</strong>AI算法学习并识别正常行为模式</li>
                        <li><strong>异常检测预警：</strong>智能判断异常情况并发出预警</li>
                        <li><strong>跌倒检测：</strong>高精度跌倒识别，准确率98.5%</li>
                    </ul>
                    
                    <h5>技术特点</h5>
                    <div class="tech-features">
                        <div class="tech-item">
                            <i class="fas fa-brain"></i>
                            <span>深度学习算法</span>
                        </div>
                        <div class="tech-item">
                            <i class="fas fa-bolt"></i>
                            <span>实时处理</span>
                        </div>
                        <div class="tech-item">
                            <i class="fas fa-shield-alt"></i>
                            <span>隐私保护</span>
                        </div>
                    </div>
                </div>
            </div>
        `
    },
    analysis: {
        title: '大数据分析平台',
        content: `
            <div class="feature-detail">
                <div class="detail-header">
                    <div class="detail-icon">
                        <i class="fas fa-chart-bar"></i>
                    </div>
                    <div class="detail-info">
                        <h4>智能数据分析</h4>
                        <p>基于大数据的深度健康分析系统</p>
                    </div>
                </div>
                
                <div class="detail-content">
                    <h5>分析能力</h5>
                    <ul>
                        <li><strong>健康趋势预测：</strong>基于历史数据的健康趋势分析</li>
                        <li><strong>风险评估：</strong>多维度健康风险评估模型</li>
                        <li><strong>个性化建议：</strong>基于个人特征的个性化健康建议</li>
                        <li><strong>数据可视化：</strong>直观的健康数据展示界面</li>
                    </ul>
                    
                    <h5>数据源</h5>
                    <div class="data-sources">
                        <span class="data-tag">活动数据</span>
                        <span class="data-tag">生理指标</span>
                        <span class="data-tag">环境数据</span>
                        <span class="data-tag">医疗记录</span>
                    </div>
                </div>
            </div>
        `
    },
    alert: {
        title: '智能预警系统',
        content: `
            <div class="feature-detail">
                <div class="detail-header">
                    <div class="detail-icon">
                        <i class="fas fa-bell"></i>
                    </div>
                    <div class="detail-info">
                        <h4>多级预警机制</h4>
                        <p>智能化的紧急情况响应系统</p>
                    </div>
                </div>
                
                <div class="detail-content">
                    <h5>预警级别</h5>
                    <div class="alert-levels">
                        <div class="alert-level critical">
                            <span class="level-icon">⚠️</span>
                            <div>
                                <strong>紧急预警</strong>
                                <p>立即通知家属和急救中心</p>
                            </div>
                        </div>
                        <div class="alert-level warning">
                            <span class="level-icon">🔔</span>
                            <div>
                                <strong>重要预警</strong>
                                <p>通知家属和社区服务中心</p>
                            </div>
                        </div>
                        <div class="alert-level info">
                            <span class="level-icon">ℹ️</span>
                            <div>
                                <strong>一般提醒</strong>
                                <p>系统自动记录并提示关注</p>
                            </div>
                        </div>
                    </div>
                    
                    <h5>响应机制</h5>
                    <ul>
                        <li>自动拨打紧急联系人电话</li>
                        <li>发送短信和APP推送通知</li>
                        <li>联动社区医疗服务中心</li>
                        <li>生成详细的预警报告</li>
                    </ul>
                </div>
            </div>
        `
    },
    assistance: {
        title: '远程协助服务',
        content: `
            <div class="feature-detail">
                <div class="detail-header">
                    <div class="detail-icon">
                        <i class="fas fa-hands-helping"></i>
                    </div>
                    <div class="detail-info">
                        <h4>全方位远程支持</h4>
                        <p>7×24小时专业远程协助服务</p>
                    </div>
                </div>
                
                <div class="detail-content">
                    <h5>服务内容</h5>
                    <div class="service-grid">
                        <div class="service-item">
                            <i class="fas fa-stethoscope"></i>
                            <div>
                                <strong>远程医疗咨询</strong>
                                <p>专业医生在线问诊</p>
                            </div>
                        </div>
                        <div class="service-item">
                            <i class="fas fa-ambulance"></i>
                            <div>
                                <strong>紧急救援服务</strong>
                                <p>快速响应紧急情况</p>
                            </div>
                        </div>
                        <div class="service-item">
                            <i class="fas fa-user-md"></i>
                            <div>
                                <strong>健康管理指导</strong>
                                <p>个性化健康管理方案</p>
                            </div>
                        </div>
                        <div class="service-item">
                            <i class="fas fa-comments"></i>
                            <div>
                                <strong>心理疏导支持</strong>
                                <p>专业心理咨询服务</p>
                            </div>
                        </div>
                    </div>
                    
                    <h5>服务特色</h5>
                    <ul>
                        <li>多语言服务支持</li>
                        <li>个性化服务定制</li>
                        <li>快速响应机制</li>
                        <li>专业服务团队</li>
                    </ul>
                </div>
            </div>
        `
    }
};

// 初始化页面
function initFeaturesPage() {
    setupTabSystem();
    setupFeatureInteractions();
    setupScrollAnimations();
    addFeatureStyles();
}

// 设置标签页系统
function setupTabSystem() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            
            // 移除所有激活状态
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));
            
            // 添加当前激活状态
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            
            // 添加切换动画
            animateTabSwitch(tabId);
        });
    });
}

// 标签页切换动画
function animateTabSwitch(tabId) {
    const activePane = document.getElementById(tabId);
    activePane.style.opacity = '0';
    activePane.style.transform = 'translateX(20px)';
    
    setTimeout(() => {
        activePane.style.opacity = '1';
        activePane.style.transform = 'translateX(0)';
        activePane.style.transition = 'all 0.4s ease';
    }, 50);
}

// 设置特色功能交互
function setupFeatureInteractions() {
    const featureItems = document.querySelectorAll('.feature-item');
    
    featureItems.forEach(item => {
        // 鼠标悬停效果
        item.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px) scale(1.02)';
            
            const icon = this.querySelector('.feature-icon');
            icon.style.transform = 'scale(1.1) rotate(5deg)';
        });
        
        item.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
            
            const icon = this.querySelector('.feature-icon');
            icon.style.transform = 'scale(1) rotate(0deg)';
        });
        
        // 点击效果
        item.addEventListener('click', function() {
            const featureType = this.getAttribute('data-feature');
            showFeatureDetail(featureType);
        });
        
        // 键盘导航支持
        item.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const featureType = this.getAttribute('data-feature');
                showFeatureDetail(featureType);
            }
        });
    });
}

// 显示特色功能详情
function showFeatureDetail(featureType) {
    const detail = featureDetails[featureType];
    if (!detail) return;
    
    const modal = document.getElementById('featureModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    
    modalTitle.textContent = detail.title;
    modalBody.innerHTML = detail.content;
    
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    
    // 添加关闭事件
    const closeHandler = function(e) {
        if (e.target === modal || e.target.classList.contains('modal-close')) {
            closeFeatureModal();
        }
    };
    
    modal.addEventListener('click', closeHandler);
    
    // ESC键关闭
    const escHandler = function(e) {
        if (e.key === 'Escape') {
            closeFeatureModal();
        }
    };
    
    document.addEventListener('keydown', escHandler);
    
    // 保存处理器以便移除
    modal._closeHandler = closeHandler;
    document._escHandler = escHandler;
}

// 关闭特色功能详情
function closeFeatureModal() {
    const modal = document.getElementById('featureModal');
    
    modal.classList.remove('show');
    document.body.style.overflow = '';
    
    // 移除事件监听器
    if (modal._closeHandler) {
        modal.removeEventListener('click', modal._closeHandler);
    }
    if (document._escHandler) {
        document.removeEventListener('keydown', document._escHandler);
    }
    
    // 添加关闭动画
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// 设置滚动动画
function setupScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // 观察需要动画的元素
    const animateElements = document.querySelectorAll('.feature-item, .advantage-card');
    animateElements.forEach(el => {
        el.classList.add('scroll-animate');
        observer.observe(el);
    });
}

// 添加特色页面样式
function addFeatureStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .feature-detail {
            color: var(--text-secondary);
        }
        
        .detail-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-light);
        }
        
        .detail-icon {
            width: 60px;
            height: 60px;
            background: var(--gradient-tech);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.5rem;
        }
        
        .detail-info h4 {
            margin: 0;
            color: var(--text-primary);
            font-size: 1.3rem;
        }
        
        .detail-info p {
            margin: 0.5rem 0 0 0;
            color: var(--text-secondary);
        }
        
        .detail-content h5 {
            color: var(--text-primary);
            margin: 1.5rem 0 1rem 0;
            font-size: 1.1rem;
        }
        
        .detail-content ul {
            list-style: none;
            padding: 0;
            margin: 1rem 0;
        }
        
        .detail-content li {
            padding: 0.5rem 0;
            border-bottom: 1px solid var(--border-light);
            position: relative;
            padding-left: 1.5rem;
        }
        
        .detail-content li::before {
            content: '▶';
            position: absolute;
            left: 0;
            color: var(--primary-green);
        }
        
        .detail-content li:last-child {
            border-bottom: none;
        }
        
        .tech-features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 1rem;
            margin: 1.5rem 0;
        }
        
        .tech-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
            padding: 1rem;
            background: var(--bg-secondary);
            border-radius: 8px;
            text-align: center;
        }
        
        .tech-item i {
            font-size: 1.5rem;
            color: var(--primary-blue);
        }
        
        .data-sources {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin: 1rem 0;
        }
        
        .data-tag {
            background: var(--primary-cyan);
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .alert-levels {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            margin: 1.5rem 0;
        }
        
        .alert-level {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem;
            border-radius: 8px;
            background: var(--bg-secondary);
        }
        
        .alert-level.critical {
            border-left: 4px solid var(--primary-red);
        }
        
        .alert-level.warning {
            border-left: 4px solid var(--primary-orange);
        }
        
        .alert-level.info {
            border-left: 4px solid var(--primary-blue);
        }
        
        .level-icon {
            font-size: 1.5rem;
        }
        
        .service-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin: 1.5rem 0;
        }
        
        .service-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem;
            background: var(--bg-secondary);
            border-radius: 8px;
        }
        
        .service-item i {
            font-size: 1.5rem;
            color: var(--primary-purple);
        }
        
        .service-item strong {
            display: block;
            color: var(--text-primary);
            margin-bottom: 0.25rem;
        }
        
        .service-item p {
            margin: 0;
            font-size: 0.9rem;
            color: var(--text-secondary);
        }
        
        @media (max-width: 768px) {
            .detail-header {
                flex-direction: column;
                text-align: center;
            }
            
            .tech-features {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .service-grid {
                grid-template-columns: 1fr;
            }
            
            .alert-level {
                flex-direction: column;
                text-align: center;
            }
        }
        
        @media (max-width: 480px) {
            .tech-features {
                grid-template-columns: 1fr;
            }
            
            .data-sources {
                justify-content: center;
            }
        }
    `;
    
    document.head.appendChild(style);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initFeaturesPage);

// 窗口调整大小处理
window.addEventListener('resize', function() {
    // 重新计算响应式布局
    const featureItems = document.querySelectorAll('.feature-item');
    featureItems.forEach(item => {
        item.style.transform = 'translateY(0) scale(1)';
    });
});

// 导出函数供全局使用
window.Features = {
    showFeatureDetail,
    closeFeatureModal
};