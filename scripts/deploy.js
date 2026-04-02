const { NodeSSH } = require('node-ssh');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const ora = require('ora');
const chalk = require('chalk');

const distDir = path.resolve(__dirname, '../dist');
const tarFile = path.resolve(__dirname, '../dist.tar.gz');
const ssh = new NodeSSH();

// 测试服务器配置
const remote = {
  host: '39.108.224.235',
  username: 'root',
  password: 'Bai08060839',
  port: 22,
  path: '/www/wwwroot/qiwei_platform_manage'
};

// 计算文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 迭代计算目录大小
function getDirSize(dir) {
  let size = 0;
  const stack = [dir];
  while (stack.length) {
    const entries = fs.readdirSync(stack.pop(), { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(entry.parentPath || entry.path, entry.name);
      entry.isDirectory() ? stack.push(p) : (size += fs.statSync(p).size);
    }
  }
  return size;
}

// 压缩 dist
async function compress() {
  // 计算压缩前大小
  const originalSize = getDirSize(distDir);
  console.log(chalk.cyan(`📊 打包文件大小: ${formatFileSize(originalSize)}`));
  
  const spinner = ora(chalk.blue('📦 正在压缩 dist 目录...')).start();
  
  return new Promise((resolve, reject) => {
    exec(`tar -zcf "${tarFile}" -C "${path.dirname(distDir)}" ${path.basename(distDir)}`, (err) => {
      if (err) {
        spinner.fail(chalk.red('压缩失败 ❌'));
        reject(err);
        return;
      }
      
      // 显示压缩后文件大小
      fs.stat(tarFile, (statErr, stats) => {
        if (statErr) {
          spinner.succeed(chalk.green('压缩完成 ✅'));
        } else {
          const ratio = ((1 - stats.size / originalSize) * 100).toFixed(1);
          spinner.succeed(chalk.green(`压缩完成 (${formatFileSize(stats.size)}, 压缩率 ${ratio}%) ✅`));
        }
        resolve();
      });
    });
  });
}

// 上传 + 解压
async function uploadAndDeploy() {
  const spinner = ora(chalk.blue('🚀 正在连接服务器...')).start();
  
  try {
    await ssh.connect({
      host: remote.host,
      username: remote.username,
      password: remote.password,
      port: remote.port
    });
    spinner.succeed(chalk.green(`连接服务器 ${remote.host}:${remote.port} ✅`));
  } catch (err) {
    spinner.fail(chalk.red('服务器连接失败 ❌'));
    throw err;
  }

  const uploadSpinner = ora(chalk.blue('📤 正在上传文件...')).start();
  try {
    await ssh.putFile(tarFile, `${remote.path}/dist.tar.gz`);
    uploadSpinner.succeed(chalk.green('文件上传成功 ✅'));
  } catch (err) {
    uploadSpinner.fail(chalk.red('文件上传失败 ❌'));
    throw err;
  }

  const deploySpinner = ora(chalk.blue('⚡ 正在远程部署...')).start();
  try {
    const cmd = `
      rm -rf ${remote.path}/dist &&
      mkdir -p ${remote.path}/dist &&
      tar -zxf ${remote.path}/dist.tar.gz -C ${remote.path}/dist --strip-components=1 &&
      rm -f ${remote.path}/dist.tar.gz
    `;
    
    await ssh.execCommand(cmd);
    deploySpinner.succeed(chalk.green('远程部署完成 ✅'));
  } catch (err) {
    deploySpinner.fail(chalk.red('远程部署失败 ❌'));
    throw err;
  }

  // 清理本地临时文件
  fs.unlinkSync(tarFile);
  console.log(chalk.gray(`已清理临时文件: ${path.basename(tarFile)}`));
  
  // 显示成功信息
  console.log(chalk.green.bold('\n🎉 部署成功！'));
  console.log(chalk.cyan('\n📁 部署信息:'));
  console.log(chalk.cyan('├─ 服务器: ') + chalk.white(remote.host));
  console.log(chalk.cyan('├─ 端口: ') + chalk.white(remote.port));
  console.log(chalk.cyan('├─ 路径: ') + chalk.white(remote.path + '/dist'));
  console.log(chalk.cyan('└─ 时间: ') + chalk.white(new Date().toLocaleTimeString()));
  
  process.exit(0);
}

// 主函数
async function main() {
  console.log(chalk.bold('\n🚀 前端部署脚本启动\n'));
  
  try {
    await compress();
    await uploadAndDeploy();
  } catch (err) {
    console.error(chalk.red.bold('\n❌ 部署过程发生错误:'));
    console.error(chalk.red(err.message || err));
    process.exit(1);
  }
}

// 执行
main();