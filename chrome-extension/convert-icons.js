const fs = require('fs');
const path = require('path');

/**
 * Chrome扩展图标管理工具
 * 用于验证和管理Chrome扩展所需的图标文件
 */

const REQUIRED_SIZES = [16, 32, 48, 128];
const ICONS_DIR = path.join(__dirname, 'icons');

/**
 * 检查文件是否存在
 * @param {string} filePath - 文件路径
 * @returns {boolean} 文件是否存在
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
}

/**
 * 获取文件大小（字节）
 * @param {string} filePath - 文件路径
 * @returns {number} 文件大小，如果文件不存在返回0
 */
function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
}

/**
 * 验证PNG文件是否为有效的PNG格式
 * @param {string} filePath - PNG文件路径
 * @returns {boolean} 是否为有效的PNG文件
 */
function isValidPNG(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    // 检查PNG文件签名
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature);
  } catch (error) {
    return false;
  }
}

/**
 * 验证所有必需的图标文件
 * @returns {Object} 验证结果
 */
function validateIcons() {
  const results = {
    valid: true,
    missing: [],
    invalid: [],
    details: []
  };

  console.log('🔍 验证Chrome扩展图标文件...');
  console.log('=' .repeat(50));

  REQUIRED_SIZES.forEach(size => {
    const svgPath = path.join(ICONS_DIR, `icon${size}.svg`);
    const pngPath = path.join(ICONS_DIR, `icon${size}.png`);
    
    const svgExists = fileExists(svgPath);
    const pngExists = fileExists(pngPath);
    const pngValid = pngExists ? isValidPNG(pngPath) : false;
    const pngSize = pngExists ? getFileSize(pngPath) : 0;
    
    const detail = {
      size,
      svgExists,
      pngExists,
      pngValid,
      pngSize,
      svgPath,
      pngPath
    };
    
    results.details.push(detail);
    
    // 输出详细信息
    console.log(`📏 ${size}x${size} 像素:`);
    console.log(`   SVG: ${svgExists ? '✅ 存在' : '❌ 缺失'} (${svgPath})`);
    console.log(`   PNG: ${pngExists ? '✅ 存在' : '❌ 缺失'} (${pngPath})`);
    
    if (pngExists) {
      console.log(`   格式: ${pngValid ? '✅ 有效PNG' : '❌ 无效PNG'}`);
      console.log(`   大小: ${(pngSize / 1024).toFixed(2)} KB`);
    }
    
    if (!pngExists) {
      results.missing.push(size);
      results.valid = false;
    } else if (!pngValid) {
      results.invalid.push(size);
      results.valid = false;
    }
    
    console.log('');
  });

  return results;
}

/**
 * 生成manifest.json中的图标配置
 * @returns {Object} 图标配置对象
 */
function generateIconConfig() {
  const config = {
    action: {
      default_icon: {}
    },
    icons: {}
  };

  REQUIRED_SIZES.forEach(size => {
    const iconPath = `icons/icon${size}.png`;
    config.action.default_icon[size] = iconPath;
    config.icons[size] = iconPath;
  });

  return config;
}

/**
 * 主函数
 */
function main() {
  console.log('🎨 Chrome扩展图标管理工具');
  console.log('=' .repeat(50));
  
  // 验证图标文件
  const validation = validateIcons();
  
  // 输出总结
  console.log('📊 验证总结:');
  console.log('=' .repeat(50));
  
  if (validation.valid) {
    console.log('✅ 所有图标文件都已准备就绪！');
  } else {
    console.log('❌ 发现问题:');
    
    if (validation.missing.length > 0) {
      console.log(`   缺失PNG文件: ${validation.missing.join(', ')} 像素`);
    }
    
    if (validation.invalid.length > 0) {
      console.log(`   无效PNG文件: ${validation.invalid.join(', ')} 像素`);
    }
    
    console.log('\n💡 建议:');
    console.log('   1. 使用在线工具转换SVG到PNG (如 convertio.co)');
    console.log('   2. 确保PNG文件尺寸正确 (16x16, 32x32, 48x48, 128x128)');
    console.log('   3. 保持图标设计的一致性');
  }
  
  // 生成配置示例
  console.log('\n⚙️  manifest.json 图标配置:');
  console.log('=' .repeat(50));
  console.log(JSON.stringify(generateIconConfig(), null, 2));
  
  console.log('\n🔧 使用说明:');
  console.log('   将上述配置复制到你的manifest.json文件中');
  console.log('   确保所有PNG文件都在icons目录下');
}

// 如果直接运行此脚本，执行主函数
if (require.main === module) {
  main();
}

// 导出函数供其他模块使用
module.exports = {
  validateIcons,
  generateIconConfig,
  fileExists,
  isValidPNG,
  getFileSize,
  REQUIRED_SIZES,
  ICONS_DIR
};