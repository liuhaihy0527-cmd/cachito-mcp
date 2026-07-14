// ═══════════ Cachito 失控2.0 MCP Server (Node.js) ═══════════
// 部署到 Railway 后，Polaris 直接通过 Streamable HTTP 连接

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3001;
const ACCOUNT = process.env.CACHITO_ACCOUNT || '183853';
const DEVICE_ID = parseInt(process.env.CACHITO_DEVICE_ID || '22');

let currentCode = null;

// ═══════════ Cachito API 调用 ═══════════
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'www.youtao.top',
      path: path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let result = '';
      res.on('data', c => result += c);
      res.on('end', () => {
        try { resolve(JSON.parse(result)); }
        catch(e) { resolve({ code: -1, message: result }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ═══════════ MCP 工具定义 ═══════════
const TOOLS = [
  {
    name: 'toy_join',
    description: '加入远程控制。用户在Cachito APP生成6位邀请码后调用此工具。',
    inputSchema: {
      type: 'object',
      properties: { invite_code: { type: 'string', description: '6位邀请码' } },
      required: ['invite_code']
    }
  },
  {
    name: 'toy_control',
    description: '控制失控玩具。action: sx(吮吸端)、pj(入体端)、stop(停止)。intensity: 0-100。duration: 毫秒。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'sx/pj/stop', enum: ['sx', 'pj', 'stop'] },
        intensity: { type: 'number', description: '强度0-100，默认30', default: 30 },
        duration: { type: 'number', description: '持续毫秒，默认3000', default: 3000 }
      },
      required: ['action']
    }
  },
  {
    name: 'toy_stop_all',
    description: '紧急停止所有端。',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'toy_pattern',
    description: '按节奏模式控制玩具，发送一组连续指令。',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: '指令数组，每项包含 action/intensity/duration',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              intensity: { type: 'number' },
              duration: { type: 'number' }
            }
          }
        }
      },
      required: ['steps']
    }
  },
  {
    name: 'toy_state',
    description: '查看当前连接状态和配置',
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
];

// ═══════════ 指令构建 ═══════════
function buildCommand(action, intensity, duration) {
  const hexVal = Math.min(Math.max(intensity || 30, 0), 100).toString(16).padStart(2, '0');

  if (action === 'stop') {
    return {
      sx: JSON.stringify([{ command: '710002**-0400-####-0302-0000000000', time: '500', progress: 0 }]),
      pj: JSON.stringify([{ command: '710002**-0400-####-0601-0000000000', time: '500', progress: 0 }])
    };
  } else if (action === 'sx') {
    return {
      key: 'sxCommand',
      cmd: JSON.stringify([{ command: `710002**-0400-####-0302-${hexVal}00000000`, time: String(duration || 3000), progress: 0 }])
    };
  } else if (action === 'pj') {
    return {
      key: 'pjCommand',
      cmd: JSON.stringify([{ command: `710002**-0400-####-030A-${hexVal}00000000`, time: String(duration || 3000), progress: 0 }])
    };
  }
  return null;
}

// ═══════════ 工具执行 ═══════════
async function callTool(name, args) {
  switch(name) {
    case 'toy_join': {
      const result = await post('/api/appRemote/joinRemote', {
        account: ACCOUNT, code: args.invite_code
      });
      if (result.code === 0) {
        currentCode = args.invite_code;
        return [{ type: 'text', text: `加入成功！邀请码 ${args.invite_code} 已就绪。可以开始控制了。` }];
      }
      return [{ type: 'text', text: `加入失败: ${result.message}。让用户重新在APP里生成邀请码。` }];
    }

    case 'toy_control': {
      if (!currentCode) return [{ type: 'text', text: '还没加入远程。先让用户生成邀请码，然后调用 toy_join。' }];

      const { action, intensity, duration } = args;
      const cmd = buildCommand(action, intensity || 30, duration || 3000);
      if (!cmd) return [{ type: 'text', text: 'action 只能是 sx/pj/stop' }];

      if (action === 'stop') {
        // 停止两端
        await post('/api/appRemote/sendCommand', {
          command: { sxCommand: cmd.sx, deviceId: DEVICE_ID },
          account: ACCOUNT, code: currentCode
        });
        await new Promise(r => setTimeout(r, 500));
        await post('/api/appRemote/sendCommand', {
          command: { pjCommand: cmd.pj, deviceId: DEVICE_ID },
          account: ACCOUNT, code: currentCode
        });
        return [{ type: 'text', text: '已停止（两端）。' }];
      }

      const result = await post('/api/appRemote/sendCommand', {
        command: { [cmd.key]: cmd.cmd, deviceId: DEVICE_ID },
        account: ACCOUNT, code: currentCode
      });

      if (result.code === 0) {
        const hexVal = Math.min(Math.max(intensity || 30, 0), 100);
        return [{ type: 'text', text: `${action === 'sx' ? '吮吸端' : '入体端'} | 强度 ${hexVal}% | 持续 ${(duration || 3000)/1000}秒 | 已发送` }];
      }
      return [{ type: 'text', text: `发送失败: ${result.message}` }];
    }

    case 'toy_stop_all': {
      if (!currentCode) return [{ type: 'text', text: '还没加入远程。' }];
      const stopSx = JSON.stringify([{ command: '710002**-0400-####-0302-0000000000', time: '500', progress: 0 }]);
      const stopPj = JSON.stringify([{ command: '710002**-0400-####-0601-0000000000', time: '500', progress: 0 }]);
      await post('/api/appRemote/sendCommand', { command: { sxCommand: stopSx, deviceId: DEVICE_ID }, account: ACCOUNT, code: currentCode });
      await new Promise(r => setTimeout(r, 500));
      await post('/api/appRemote/sendCommand', { command: { pjCommand: stopPj, deviceId: DEVICE_ID }, account: ACCOUNT, code: currentCode });
      return [{ type: 'text', text: '紧急停止：两端已停止。' }];
    }

    case 'toy_pattern': {
      if (!currentCode) return [{ type: 'text', text: '还没加入远程。' }];
      const results = [];
      for (const step of (args.steps || [])) {
        const cmd = buildCommand(step.action, step.intensity || 30, step.duration || 3000);
        if (!cmd) continue;
        if (step.action === 'stop') {
          await post('/api/appRemote/sendCommand', { command: { sxCommand: cmd.sx, deviceId: DEVICE_ID }, account: ACCOUNT, code: currentCode });
          await new Promise(r => setTimeout(r, 500));
          await post('/api/appRemote/sendCommand', { command: { pjCommand: cmd.pj, deviceId: DEVICE_ID }, account: ACCOUNT, code: currentCode });
        } else {
          await post('/api/appRemote/sendCommand', { command: { [cmd.key]: cmd.cmd, deviceId: DEVICE_ID }, account: ACCOUNT, code: currentCode });
        }
        results.push(`${step.action} ${step.intensity || 30}% ${(step.duration || 3000)/1000}s`);
        await new Promise(r => setTimeout(r, Math.max((step.duration || 3000) + 200, 700)));
      }
      return [{ type: 'text', text: `节奏模式完成：${results.join(' → ')}` }];
    }

    case 'toy_state': {
      return [{ type: 'text', text: `账号: ${ACCOUNT}\n设备ID: ${DEVICE_ID}\n邀请码: ${currentCode || '未设置'}\n状态: ${currentCode ? '已连接' : '未连接'}` }];
    }

    default: return [{ type: 'text', text: 'Unknown tool: ' + name }];
  }
}

// ═══════════ MCP Streamable HTTP Server ═══════════
async function handleJsonRpc(request) {
  const { id, method, params } = request;
  switch(method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'cachito-toy-control', version: '1.0.0' } } };
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call': {
      try {
        const content = await callTool(params.name, params.arguments || {});
        return { jsonrpc: '2.0', id, result: { content } };
      } catch(e) {
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } };
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } };
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const request = JSON.parse(body);
        console.log('[REQ]', request.method, request.id || '');
        const result = await handleJsonRpc(request);
        if (result === null) { res.writeHead(202); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'cachito-session' });
        res.end(JSON.stringify(result));
        console.log('[RES]', result.result ? 'ok' : 'error');
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: e.message } }));
      }
    });
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Cachito Toy Control MCP Server is running.');
    return;
  }

  if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('  Cachito Toy Control MCP Server');
  console.log('  Port: ' + PORT);
  console.log('  Account: ' + ACCOUNT);
  console.log('  Device ID: ' + DEVICE_ID);
  console.log('=================================');
});
