// PromptMaster Chrome Extension - 集成后端服务的Service Worker
// 基于Manifest V3的Service Worker，包含飞书API调用功能

// Service Worker 生命周期管理
let keepAliveInterval;
let promptRefreshInterval;

// 保持 Service Worker 活跃
function keepServiceWorkerAlive() {
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // 简单的操作来保持 Service Worker 活跃
    });
  }, 20000); // 每20秒执行一次
}

// 清理定时器
function clearKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  
  if (promptRefreshInterval) {
    clearInterval(promptRefreshInterval);
    promptRefreshInterval = null;
  }
}

// 配置常量
const CONFIG = {
  FEISHU_BASE_URL: 'https://open.feishu.cn/open-apis',
  STORAGE_KEYS: {
    SETTINGS: 'promptmaster_settings',
    CACHE: 'promptmaster_cache',
    RECENT_PROMPTS: 'promptmaster_recent',
    FEISHU_CONFIG: 'promptmaster_feishu_config',
    ACCESS_TOKEN: 'promptmaster_access_token',
    PERMANENT_PROMPTS: 'promptmaster_permanent_prompts',
    LAST_REFRESH_TIME: 'promptmaster_last_refresh_time'
  },
  CACHE_DURATION: 5 * 60 * 1000, // 5分钟缓存
  TOKEN_CACHE_DURATION: 110 * 60 * 1000, // 110分钟（飞书token有效期2小时）
  AUTO_REFRESH_INTERVAL: 30 * 60 * 1000, // 30分钟自动刷新一次
  MAX_PAGE_SIZE: 500, // 飞书API单次最大请求数量
  MAX_RECORDS_WARNING: 18000, // 数据量警告阈值
  MAX_RECORDS_LIMIT: 20000 // 数据量硬限制
};

// 默认设置
const DEFAULT_SETTINGS = {
  triggerChar: '/',
  theme: 'auto',
  shortcuts: {
    capture: 'Ctrl+Shift+S',
    toggle: 'Ctrl+Shift+P'
  },
  autoSave: true,
  maxRecentItems: 10,
  autoRefresh: {
    enabled: true,
    interval: 30 // 单位：分钟
  }
};

// 飞书字段映射
const FEISHU_FIELD_MAPPING = {
  title: '标题',
  content: '内容',
  description: '描述',
  category: '分类',
  alias: '别名',
  tags: '标签',
  isPublic: '是否公开',
  createdBy: '创建者',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  usageCount: '使用次数',
  favoriteCount: '收藏次数'
};

/**
 * 飞书API服务类
 */
class FeishuService {
  constructor() {
    this.baseUrl = CONFIG.FEISHU_BASE_URL;
    this.accessToken = null;
    this.config = null;
  }

  /**
   * 初始化配置
   */
  async initConfig() {
    if (!this.config) {
      // 获取用户配置和配置模式
      const result = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.FEISHU_CONFIG, 'promptmaster_config_mode']);
      const userConfig = result[CONFIG.STORAGE_KEYS.FEISHU_CONFIG];
      const configMode = result.promptmaster_config_mode || 'benefit'; // 'benefit' 或 'custom'

      if (configMode === 'custom' && userConfig && (userConfig.appId || userConfig.bitableAppToken)) {
        // 用户自定义配置模式（使用用户自己的飞书应用配置）
        this.config = {
          ...userConfig // 用户提供的完整飞书应用配置
        };
        console.log('🔧 使用用户自定义飞书应用配置');
      } else {
        // 福利配置模式（默认）
        this.config = {
          appId: 'cli_a84466381e74100b', // 您的飞书应用ID
          appSecret: 'ocqzZ4FLobQd5piurZLkbg3T5R2k05R2', // 您的飞书应用密钥
          bitableAppToken: 'V2YYbOqo4aSq6RsEpxlcYqvanXc', // 您的多维表格应用Token
          bitableTableId: 'tblaxnEdrJMpnJD9', // 您的数据表ID
          ...userConfig // 允许用户配置覆盖默认配置
        };
        console.log('🎁 使用福利飞书配置，为用户提供优质提示词库');
      }
    }
    return this.config;
  }

  /**
   * 获取访问令牌
   */
  async getAccessToken() {
    // 先尝试从缓存获取
    const cached = await CacheService.get('access_token');
    if (cached) {
      this.accessToken = cached;
      return cached;
    }

    await this.initConfig();
    
    try {
      const response = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret
        })
      });

      const data = await response.json();
      
      if (data.code !== 0) {
        throw new Error(`获取访问令牌失败: ${data.msg}`);
      }

      this.accessToken = data.tenant_access_token;
      
      // 缓存token（110分钟）
      await CacheService.set('access_token', this.accessToken, CONFIG.TOKEN_CACHE_DURATION / 1000);
      
      return this.accessToken;
    } catch (error) {
      console.error('获取飞书访问令牌失败:', error);
      throw error;
    }
  }

  /**
   * 获取单页记录
   */
  async getRecords(pageToken = '', pageSize = CONFIG.MAX_PAGE_SIZE) {
    await this.initConfig();
    
    if (!this.accessToken) {
      await this.getAccessToken();
    }

    const url = new URL(`${this.baseUrl}/bitable/v1/apps/${this.config.bitableAppToken}/tables/${this.config.bitableTableId}/records`);
    url.searchParams.set('page_size', pageSize.toString());
    if (pageToken) {
      url.searchParams.set('page_token', pageToken);
    }

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      if (data.code !== 0) {
        // 如果是token过期，重新获取token并重试
        if (data.code === 99991663) {
          await CacheService.remove('access_token');
          this.accessToken = null;
          await this.getAccessToken();
          return this.getRecords(pageToken, pageSize);
        }
        throw new Error(`获取记录失败: ${data.msg}`);
      }

      return data.data;
    } catch (error) {
      console.error('获取飞书记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有记录（自动分页）
   */
  async getAllRecords() {
    const allRecords = [];
    let pageToken = '';
    let hasMore = true;
    let totalFetched = 0;

    console.log('开始获取所有飞书记录...');

    while (hasMore) {
      const data = await this.getRecords(pageToken, CONFIG.MAX_PAGE_SIZE);
      
      if (data.items && data.items.length > 0) {
        allRecords.push(...data.items);
        totalFetched += data.items.length;
        
        console.log(`已获取 ${totalFetched} 条记录`);
        
        // 检查数据量限制
        if (totalFetched >= CONFIG.MAX_RECORDS_LIMIT) {
          console.warn(`数据量已达到硬限制 ${CONFIG.MAX_RECORDS_LIMIT} 条，停止获取`);
          break;
        }
        
        // 数据量警告
        if (totalFetched >= CONFIG.MAX_RECORDS_WARNING) {
          console.warn(`数据量较大 (${totalFetched} 条)，建议优化数据结构`);
        }
      }
      
      hasMore = data.has_more;
      pageToken = data.page_token || '';
      
      // 避免请求过于频繁
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`获取完成，总计 ${allRecords.length} 条记录`);
    return {
      items: allRecords,
      total: allRecords.length,
      has_more: false
    };
  }

  /**
   * 转换飞书记录为提示词格式
   */
  convertToPrompt(record) {
    const fields = record.fields || {};
    
    // 解析标签
    let tags = [];
    if (fields[FEISHU_FIELD_MAPPING.tags]) {
      const tagValue = fields[FEISHU_FIELD_MAPPING.tags];
      if (Array.isArray(tagValue)) {
        tags = tagValue.map(tag => typeof tag === 'object' ? tag.text : tag).filter(Boolean);
      } else if (typeof tagValue === 'string') {
        tags = tagValue.split(',').map(tag => tag.trim()).filter(Boolean);
      }
    }

    // 解析变量（从内容中提取）
    const content = fields[FEISHU_FIELD_MAPPING.content] || '';
    const variables = this.extractVariables(content);

    return {
      id: record.record_id,
      title: fields[FEISHU_FIELD_MAPPING.title] || '',
      content: content,
      description: fields[FEISHU_FIELD_MAPPING.description] || '',
      category: fields[FEISHU_FIELD_MAPPING.category] || '',
      alias: fields[FEISHU_FIELD_MAPPING.alias] || '',
      tags: tags,
      variables: variables,
      isPublic: Boolean(fields[FEISHU_FIELD_MAPPING.isPublic]),
      createdBy: fields[FEISHU_FIELD_MAPPING.createdBy] || '',
      createdAt: fields[FEISHU_FIELD_MAPPING.createdAt] || new Date().toISOString(),
      updatedAt: fields[FEISHU_FIELD_MAPPING.updatedAt] || new Date().toISOString(),
      usageCount: parseInt(fields[FEISHU_FIELD_MAPPING.usageCount]) || 0,
      favoriteCount: parseInt(fields[FEISHU_FIELD_MAPPING.favoriteCount]) || 0
    };
  }

  /**
   * 从内容中提取变量
   */
  extractVariables(content) {
    const variables = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    const seen = new Set();

    while ((match = regex.exec(content)) !== null) {
      const varName = match[1].trim();
      if (!seen.has(varName)) {
        seen.add(varName);
        variables.push({
          name: varName,
          description: '',
          defaultValue: '',
          required: true
        });
      }
    }

    return variables;
  }

  /**
   * 创建新记录到飞书多维表格
   */
  async createRecord(promptData) {
    await this.initConfig();
    
    if (!this.accessToken) {
      await this.getAccessToken();
    }

    // 转换提示词数据为飞书字段格式 - 只设置内容字段，其他保持默认
    const fields = {};

    if (promptData.content) {
      fields[FEISHU_FIELD_MAPPING.content] = promptData.content;
    }

    // 对于新记录，设置基本的默认值
    if (promptData.title) {
      fields[FEISHU_FIELD_MAPPING.title] = promptData.title;
    }

    if (promptData.category) {
      fields[FEISHU_FIELD_MAPPING.category] = promptData.category;
    }

    const url = `${this.baseUrl}/bitable/v1/apps/${this.config.bitableAppToken}/tables/${this.config.bitableTableId}/records`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: fields
        })
      });

      const data = await response.json();
      
      if (data.code !== 0) {
        // 如果是token过期，重新获取token并重试
        if (data.code === 99991663) {
          await CacheService.remove('access_token');
          this.accessToken = null;
          await this.getAccessToken();
          return this.createRecord(promptData);
        }
        throw new Error(`创建记录失败: ${data.msg}`);
      }

      console.log('成功创建提示词记录:', data.data.record.record_id);
      return data.data.record;
    } catch (error) {
      console.error('创建飞书记录失败:', error);
      throw error;
    }
  }
}

/**
 * 缓存服务类
 */
class CacheService {
  static async set(key, data, ttl = 3600) {
    const item = {
      data: data,
      timestamp: Date.now(),
      ttl: ttl * 1000
    };
    await chrome.storage.local.set({ [`cache_${key}`]: item });
  }
  
  static async get(key) {
    const result = await chrome.storage.local.get([`cache_${key}`]);
    const item = result[`cache_${key}`];
    
    if (!item) return null;
    
    if (Date.now() - item.timestamp > item.ttl) {
      await chrome.storage.local.remove([`cache_${key}`]);
      return null;
    }
    
    return item.data;
  }
  
  static async remove(key) {
    await chrome.storage.local.remove([`cache_${key}`]);
  }
  
  static async clear() {
    const storage = await chrome.storage.local.get();
    const cacheKeys = Object.keys(storage).filter(key => key.startsWith('cache_'));
    if (cacheKeys.length > 0) {
      await chrome.storage.local.remove(cacheKeys);
    }
  }
}

/**
 * 提示词服务类
 */
class PromptService {
  constructor() {
    this.feishuService = new FeishuService();
  }

  /**
   * 永久保存提示词数据
   */
  async savePermanentPrompts(prompts) {
    try {
      const data = {
        prompts: prompts,
        lastUpdated: Date.now(),
        version: '1.0'
      };
      await chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]: data });
      console.log(`已永久保存 ${prompts.length} 条提示词数据`);
    } catch (error) {
      console.error('保存永久提示词数据失败:', error);
      throw error;
    }
  }

  /**
   * 获取永久保存的提示词数据
   */
  async getPermanentPrompts() {
    try {
      const result = await chrome.storage.local.get([CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]);
      const data = result[CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS];
      
      if (!data || !data.prompts) {
        return [];
      }
      
      console.log(`从永久存储获取到 ${data.prompts.length} 条提示词数据`);
      return data.prompts;
    } catch (error) {
      console.error('获取永久提示词数据失败:', error);
      return [];
    }
  }

  /**
   * 检查是否有永久保存的数据
   */
  async hasPermanentPrompts() {
    try {
      const result = await chrome.storage.local.get([CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]);
      const data = result[CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS];
      return data && data.prompts && data.prompts.length > 0;
    } catch (error) {
      console.error('检查永久提示词数据失败:', error);
      return false;
    }
  }

  /**
   * 查询提示词
   */
  async queryPrompts(params = {}) {
    const {
      page = 1,
      pageSize = 20,
      keyword = '',
      category = '',
      tags = [],
      isPublic,
      createdBy = '',
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      getAllData = false,
      forceRefresh = false
    } = params;

    try {
      let prompts = [];
      
      // 优先从永久存储获取数据
      if (!forceRefresh) {
        prompts = await this.getPermanentPrompts();
        if (prompts.length > 0) {
          console.log('从永久存储返回提示词数据');
        }
      }
      
      // 如果没有永久数据或强制刷新，则从飞书获取
      if (prompts.length === 0 || forceRefresh) {
        console.log('从飞书API获取提示词数据');
        let feishuData;
        if (getAllData || forceRefresh) {
          feishuData = await this.feishuService.getAllRecords();
        } else {
          feishuData = await this.feishuService.getRecords('', Math.min(pageSize * 10, CONFIG.MAX_PAGE_SIZE));
        }

        // 转换数据格式
        prompts = feishuData.items.map(record => this.feishuService.convertToPrompt(record));
        
        // 永久保存获取到的数据
        if (prompts.length > 0) {
          await this.savePermanentPrompts(prompts);
        }
      }

      // 应用过滤条件
      prompts = this.applyFilters(prompts, {
        keyword,
        category,
        tags,
        isPublic,
        createdBy
      });

      // 应用排序
      prompts = this.applySorting(prompts, sortBy, sortOrder);

      // 分页处理
      const total = prompts.length;
      const totalPages = Math.ceil(total / pageSize);
      
      if (!getAllData) {
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        prompts = prompts.slice(startIndex, endIndex);
      }

      const result = {
        items: prompts,
        pagination: {
          page: getAllData ? 1 : page,
          pageSize: getAllData ? total : pageSize,
          total,
          totalPages: getAllData ? 1 : totalPages,
          hasNext: getAllData ? false : page < totalPages,
          hasPrev: getAllData ? false : page > 1
        },
        fromPermanentStorage: !forceRefresh && await this.hasPermanentPrompts()
      };

      return result;
    } catch (error) {
      console.error('查询提示词失败:', error);
      // 如果飞书API失败，尝试从永久存储获取
      if (!forceRefresh) {
        const permanentPrompts = await this.getPermanentPrompts();
        if (permanentPrompts.length > 0) {
          console.log('飞书API失败，使用永久存储的数据');
          return this.queryPrompts({ ...params, forceRefresh: false });
        }
      }
      throw error;
    }
  }

  /**
   * 应用过滤条件
   */
  applyFilters(prompts, filters) {
    return prompts.filter(prompt => {
      // 关键词过滤
      if (filters.keyword) {
        const keyword = filters.keyword.toLowerCase();
        const searchText = `${prompt.title} ${prompt.content} ${prompt.description} ${prompt.tags.join(' ')}`.toLowerCase();
        if (!searchText.includes(keyword)) {
          return false;
        }
      }

      // 分类过滤
      if (filters.category && prompt.category !== filters.category) {
        return false;
      }

      // 标签过滤
      if (filters.tags && filters.tags.length > 0) {
        const hasMatchingTag = filters.tags.some(tag => prompt.tags.includes(tag));
        if (!hasMatchingTag) {
          return false;
        }
      }

      // 公开状态过滤
      if (filters.isPublic !== undefined && prompt.isPublic !== filters.isPublic) {
        return false;
      }

      // 创建者过滤
      if (filters.createdBy && prompt.createdBy !== filters.createdBy) {
        return false;
      }

      return true;
    });
  }

  /**
   * 应用排序
   */
  applySorting(prompts, sortBy, sortOrder) {
    return prompts.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      // 处理日期字段
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }

      // 处理数字字段
      if (sortBy === 'usageCount' || sortBy === 'favoriteCount') {
        aValue = Number(aValue) || 0;
        bValue = Number(bValue) || 0;
      }

      // 处理字符串字段
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      let result = 0;
      if (aValue < bValue) result = -1;
      else if (aValue > bValue) result = 1;

      return sortOrder === 'desc' ? -result : result;
    });
  }

  /**
   * 根据ID获取提示词
   */
  async getPromptById(id) {
    try {
      // 优先从永久存储获取
      const permanentPrompts = await this.getPermanentPrompts();
      if (permanentPrompts.length > 0) {
        const prompt = permanentPrompts.find(p => p.id === id);
        if (prompt) {
          console.log('从永久存储获取提示词:', id);
          return prompt;
        }
      }

      // 如果永久存储中没有，从完整列表中查找
      const result = await this.queryPrompts({ getAllData: true });
      const prompt = result.items.find(p => p.id === id);
      
      if (!prompt) {
        throw new Error('提示词不存在');
      }
      
      return prompt;
    } catch (error) {
      console.error('获取提示词失败:', error);
      throw error;
    }
  }

  /**
   * 创建新提示词
   */
  async createPrompt(promptData) {
    try {
      console.log('开始创建提示词:', promptData);
      const createdRecord = await this.feishuService.createRecord(promptData);
      console.log('提示词创建成功:', createdRecord.record_id);
      return createdRecord;
    } catch (error) {
      console.error('创建提示词失败:', error);
      throw error;
    }
  }

  /**
   * 创建新提示词
   */
  async createPrompt(promptData) {
    try {
      console.log('开始创建提示词:', promptData);
      const createdRecord = await this.feishuService.createRecord(promptData);
      console.log('提示词创建成功:', createdRecord.record_id);
      return createdRecord;
    } catch (error) {
      console.error('创建提示词失败:', error);
      throw error;
    }
  }
}

// 全局服务实例
const promptService = new PromptService();

// 启动自动刷新提示词功能
async function startAutoRefresh() {
  try {
    // 获取设置
    const result = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.SETTINGS]);
    const settings = result[CONFIG.STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
    
    // 如果自动刷新已经启用
    if (settings.autoRefresh && settings.autoRefresh.enabled) {
      // 清除现有定时器
      if (promptRefreshInterval) {
        clearInterval(promptRefreshInterval);
      }
      
      // 获取间隔时间（分钟转毫秒）
      const interval = (settings.autoRefresh.interval || 30) * 60 * 1000;
      
      console.log(`启动自动刷新提示词，间隔: ${interval / 60000} 分钟`);
      
      // 立即执行一次刷新
      await refreshPrompts();
      
      // 设置定时器
      promptRefreshInterval = setInterval(async () => {
        await refreshPrompts();
      }, interval);
    }
  } catch (error) {
    console.error('启动自动刷新失败:', error);
  }
}

// 刷新提示词数据
async function refreshPrompts() {
  try {
    console.log('自动刷新提示词数据...');
    
    // 检查飞书配置
    const hasConfig = await checkFeishuConfig();
    if (!hasConfig) {
      console.log('飞书配置不完整，跳过刷新');
      throw new Error('飞书配置不完整');
    }
    
    // 检查连接
    const isConnected = await checkFeishuConnection();
    if (!isConnected) {
      console.log('飞书连接失败，跳过刷新');
      throw new Error('飞书连接失败');
    }
    
    // 从飞书获取最新数据
    const result = await promptService.queryPrompts({ getAllData: true, forceRefresh: true });
    console.log('刷新获取到数据:', result.items?.length || 0, '条');
    
    // 记录最后刷新时间
    await chrome.storage.local.set({
      [CONFIG.STORAGE_KEYS.LAST_REFRESH_TIME]: Date.now()
    });
    
    console.log('提示词数据刷新完成，时间:', new Date().toLocaleString());
  } catch (error) {
    console.error('刷新提示词数据失败:', error);
    throw error;
  }
}

// 检查飞书配置
async function checkFeishuConfig() {
  try {
    // 创建服务实例检查内置配置
    const feishuService = new FeishuService();
    const config = await feishuService.initConfig();

    // 检查是否有用户自定义配置
    const result = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.FEISHU_CONFIG]);
    const userConfig = result[CONFIG.STORAGE_KEYS.FEISHU_CONFIG];

    const isValid = config && config.appId && config.appSecret && config.bitableAppToken && config.bitableTableId;
    console.log('🎁 福利飞书配置检查:', { isValid, hasUserConfig: !!userConfig });
    return isValid;
  } catch (error) {
    console.error('检查飞书配置失败:', error);
    return false;
  }
}

// 插件安装时初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('PromptMaster Extension installed:', details.reason);
  
  // 启动保活机制
  keepServiceWorkerAlive();
  
  // 创建右键菜单
  createContextMenus();
  
  // 初始化默认设置
  const result = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.SETTINGS]);
  if (!result[CONFIG.STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.sync.set({
      [CONFIG.STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS
    });
  }
  
  // 清理过期缓存
  await clearExpiredCache();
  
  // 启动自动刷新
  await startAutoRefresh();
  
  console.log('PromptMaster 插件初始化完成');
});

// Service Worker 启动时
chrome.runtime.onStartup.addListener(async () => {
  console.log('Service Worker 启动');
  keepServiceWorkerAlive();
  
  // 启动自动刷新
  await startAutoRefresh();
});

// Service Worker 挂起前
chrome.runtime.onSuspend.addListener(() => {
  console.log('Service Worker 即将挂起');
  clearKeepAlive();
});

// 创建右键菜单
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'capture-prompt',
      title: '保存到 PromptMaster',
      contexts: ['selection']
    });
    
    chrome.contextMenus.create({
      id: 'open-manager',
      title: '打开 PromptMaster',
      contexts: ['all']
    });
  });
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'capture-prompt':
      await handleCapturePrompt(info, tab);
      break;
    case 'open-manager':
      await openManager();
      break;
  }
});

// 处理消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 确保 Service Worker 保持活跃
  if (!keepAliveInterval) {
    keepServiceWorkerAlive();
  }
  
  handleMessage(request, sender, sendResponse);
  return true; // 保持消息通道开放
});

// 消息处理函数
async function handleMessage(request, sender, sendResponse) {
  try {
    switch (request.action) {
      case 'getPrompts':
        const prompts = await promptService.queryPrompts({ getAllData: true, ...(request.params || {}) });
        sendResponse({ success: true, data: prompts });
        break;
        
      case 'getPromptById':
        const prompt = await promptService.getPromptById(request.id);
        sendResponse({ success: true, data: prompt });
        break;
        
      case 'searchPrompts':
        const searchResults = await promptService.queryPrompts({
          keyword: request.keyword,
          pageSize: 50
        });
        sendResponse({ success: true, data: searchResults });
        break;
        
      case 'createPrompt':
        try {
          const createdRecord = await promptService.createPrompt(request.promptData);
          // 创建成功后清除缓存，强制刷新数据
          await CacheService.clear();
          await chrome.storage.local.remove([CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]);
          sendResponse({ success: true, data: createdRecord });
        } catch (error) {
          console.error('创建提示词失败:', error);
          sendResponse({ success: false, error: error.message });
        }
        break;
        
      case 'clearCache':
        await CacheService.clear();
        sendResponse({ success: true });
        break;
        
      case 'refreshPrompts':
        const refreshedPrompts = await promptService.queryPrompts({ getAllData: true, forceRefresh: true });
        sendResponse({ success: true, data: refreshedPrompts });
        break;
        
      case 'getPermanentPromptsInfo':
        const hasPermanent = await promptService.hasPermanentPrompts();
        const permanentPrompts = await promptService.getPermanentPrompts();
        const lastRefreshResult = await chrome.storage.local.get([CONFIG.STORAGE_KEYS.LAST_REFRESH_TIME]);
        const lastRefreshTime = lastRefreshResult[CONFIG.STORAGE_KEYS.LAST_REFRESH_TIME];
        
        sendResponse({ 
          success: true, 
          data: { 
            hasPermanentData: hasPermanent,
            count: permanentPrompts.length,
            lastUpdated: lastRefreshTime ? new Date(lastRefreshTime).toLocaleString() : null
          } 
        });
        break;
        
      case 'clearPermanentPrompts':
        await chrome.storage.local.remove([CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]);
        sendResponse({ success: true });
        break;
        
      case 'manualRefresh':
        await refreshPrompts();
        sendResponse({ 
          success: true, 
          data: { 
            lastRefreshTime: new Date().toLocaleString() 
          } 
        });
        break;
        
      case 'getAutoRefreshStatus':
        const settingsResult = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.SETTINGS]);
        const settings = settingsResult[CONFIG.STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
        const lastRefreshTimeResult = await chrome.storage.local.get([CONFIG.STORAGE_KEYS.LAST_REFRESH_TIME]);
        const refreshTime = lastRefreshTimeResult[CONFIG.STORAGE_KEYS.LAST_REFRESH_TIME];
        
        sendResponse({ 
          success: true, 
          data: { 
            enabled: settings.autoRefresh?.enabled || false,
            interval: settings.autoRefresh?.interval || 30,
            lastRefreshTime: refreshTime ? new Date(refreshTime).toLocaleString() : null
          } 
        });
        break;
        
      case 'setAutoRefreshSettings':
        const currentSettings = await getSettings();
        const updatedSettings = {
          ...currentSettings,
          autoRefresh: {
            enabled: request.enabled !== undefined ? request.enabled : (currentSettings.autoRefresh?.enabled || true),
            interval: request.interval || currentSettings.autoRefresh?.interval || 30
          }
        };
        
        await chrome.storage.sync.set({
          [CONFIG.STORAGE_KEYS.SETTINGS]: updatedSettings
        });
        
        // 重启自动刷新服务
        await startAutoRefresh();
        
        sendResponse({ success: true });
        break;
        
      case 'getStats':
        const allPrompts = await promptService.queryPrompts({ getAllData: true });
        const statsData = {
          total: allPrompts.items ? allPrompts.items.length : 0,
          todayUsage: 0, // TODO: 实现使用统计
          weekUsage: 0   // TODO: 实现使用统计
        };
        sendResponse({ success: true, data: statsData });
        break;
        
      case 'checkConnection':
        try {
          const isConnected = await checkFeishuConnection();
          console.log('连接检查结果:', isConnected);
          sendResponse({ success: true, data: { connected: isConnected } });
        } catch (error) {
          console.error('连接检查错误:', error);
          sendResponse({ success: true, data: { connected: false } });
        }
        break;
        
      default:
        sendResponse({ success: false, error: '未知操作' });
    }
  } catch (error) {
    console.error('处理消息失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 检查飞书连接
async function checkFeishuConnection() {
  try {
    const result = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.FEISHU_CONFIG]);
    const config = result[CONFIG.STORAGE_KEYS.FEISHU_CONFIG];
    
    if (!config || !config.appId || !config.appSecret || !config.bitableAppToken || !config.bitableTableId) {
      return false;
    }
    
    // 尝试获取访问令牌
    const feishuService = new FeishuService();
    await feishuService.getAccessToken();
    return true;
  } catch (error) {
    console.error('检查飞书连接失败:', error);
    return false;
  }
}

// 处理捕获提示词
async function handleCapturePrompt(info, tab) {
  if (info.selectionText) {
    // 发送到content script处理
    chrome.tabs.sendMessage(tab.id, {
      action: 'showCaptureDialog',
      text: info.selectionText
    });
  }
}

// 打开管理器
async function openManager() {
  // 这里可以打开一个新标签页或者弹窗
  chrome.tabs.create({
    url: chrome.runtime.getURL('popup.html')
  });
}

// 获取设置
async function getSettings() {
  const result = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.SETTINGS]);
  return result[CONFIG.STORAGE_KEYS.SETTINGS] || {};
}

// 清理过期缓存
async function clearExpiredCache() {
  const storage = await chrome.storage.local.get();
  const now = Date.now();
  const keysToRemove = [];
  
  for (const [key, value] of Object.entries(storage)) {
    if (key.startsWith('cache_') && value.timestamp) {
      if (now - value.timestamp > value.ttl) {
        keysToRemove.push(key);
      }
    }
  }
  
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
    console.log(`清理了 ${keysToRemove.length} 个过期缓存`);
  }
}

// 定期清理缓存
setInterval(clearExpiredCache, 10 * 60 * 1000); // 每10分钟清理一次

console.log('PromptMaster Service Worker 已启动');