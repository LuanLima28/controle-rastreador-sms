// Backend para comandos específicos de rastreador - SMSMarket
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');

const app = express();

// Configurações SMSMarket
const USER = 'luanlima';
const PASSWORD = 'N0v453nh4!';
const BASE_URL = 'https://api.smsmarket.com.br/webservice-rest';

// Middleware
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Comandos específicos solicitados
const COMANDOS = {
  'fuso': 'GMT,W,0,0#',
  'apn_vivo': 'APN,wl.vivo.com.br,vivo,vivo#',
  'servidor': 'SERVER,0,144.202.13.234,6809,0#',
  'intervalo': 'TIMER,30,3600#',
  'voltagem': 'SZCS#GT06SEL=1#GT06IEXVOL=2',
  'ignicao': 'SZCS#ACCLINE=0',
  'gps_parado': 'SZCS#GPS_DISSLP=0',
  'economia_sms': 'SZCS#SLPDISCONNECT=2',
  'reiniciar': 'SZCS#TIMING_RESET=1',
  'km': 'SZCS#GT06SEL=1#GT06METER=0',
  'reset': 'RESET#'
};

// Página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Função para enviar SMS para um número
async function enviarSMSParaNumero(numero, mensagem) {
  try {
    const response = await axios.post(
      `${BASE_URL}/send-single`,
      new URLSearchParams({
        user: USER,
        password: PASSWORD,
        type: '0',
        country_code: '55',
        number: numero,
        content: mensagem,
        campaign_id: `cmd_${Date.now()}_${numero}`
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return {
      sucesso: true,
      numero: numero,
      dados: response.data,
      status: response.data.responseDescription || 'Enviado'
    };
  } catch (error) {
    console.error(`Erro para número ${numero}:`, error.response?.data || error.message);
    return {
      sucesso: false,
      numero: numero,
      erro: error.response?.data || error.message,
      status: 'Erro no envio'
    };
  }
}

// Envio de SMS - Suporte a múltiplos números
app.post('/api/enviar', async (req, res) => {
  const { numeros, numero, comando, mensagem_custom } = req.body;

  // Suporte tanto para o campo antigo (numero) quanto para o novo (numeros)
  let listaNumeros = [];
  if (numeros && Array.isArray(numeros)) {
    listaNumeros = numeros;
  } else if (numero) {
    // Compatibilidade com versão anterior
    listaNumeros = numero.toString().split(',').map(n => n.trim()).filter(n => n.length > 0);
  } else {
    return res.status(400).json({ erro: 'Número(s) são obrigatórios' });
  }

  if (listaNumeros.length === 0) {
    return res.status(400).json({ erro: 'Pelo menos um número válido é obrigatório' });
  }

  // Usar comando pré-definido ou personalizado
  const mensagem = mensagem_custom || COMANDOS[comando];
  if (!mensagem) {
    return res.status(400).json({ erro: 'Comando ou mensagem personalizada é obrigatória' });
  }

  try {
    // Enviar para todos os números
    const resultados = await Promise.all(
      listaNumeros.map(numero => enviarSMSParaNumero(numero, mensagem))
    );

    // Verificar se pelo menos um envio foi bem-sucedido
    const sucessos = resultados.filter(r => r.sucesso);
    const erros = resultados.filter(r => !r.sucesso);

    res.json({
      sucesso: sucessos.length > 0,
      total_numeros: listaNumeros.length,
      sucessos: sucessos.length,
      erros: erros.length,
      mensagem: mensagem,
      resultados: resultados
    });

  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({
      sucesso: false,
      erro: 'Erro interno do servidor'
    });
  }
});

// Consulta de saldo
app.get('/api/saldo', async (req, res) => {
  try {
    const response = await axios.get(`${BASE_URL}/balance`, {
      params: {
        user: USER,
        password: PASSWORD
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Erro ao consultar saldo:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false,
      erro: 'Erro ao consultar saldo' 
    });
  }
});

// Consulta por período
app.post('/api/status/periodo', async (req, res) => {
  const { start_date, end_date } = req.body;

  if (!start_date || !end_date) {
    return res.status(400).json({ erro: 'Datas são obrigatórias' });
  }

  try {
    const response = await axios.get(`${BASE_URL}/mt_date`, {
      params: {
        user: USER,
        password: PASSWORD,
        start_date,
        end_date
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Erro ao consultar período:', error.response?.data || error.message);
    res.status(500).json({ erro: 'Erro ao consultar período' });
  }
});

// Endpoint de teste
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    comandos_disponiveis: Object.keys(COMANDOS),
    tcp_ativo: true
  });
});

// ====================================
// ADIÇÕES TCP - SERVIDOR PARA RASTREADORES J16
// ====================================

const net = require('net');
const WebSocket = require('ws');
const http = require('http');

// Criar servidor HTTP para compartilhar porta com Express
const server = http.createServer(app);

// WebSocket para comunicação em tempo real com frontend
const wss = new WebSocket.Server({ server });

// Armazenar informações dos dispositivos conectados
const dispositivosConectados = new Map();

// Função para broadcast de mensagens para todos os clientes WebSocket
function broadcastToClients(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error('Erro ao enviar WebSocket:', error.message);
      }
    }
  });
}

// Função para extrair IMEI da mensagem (protocolo J16/EC33)
function extrairIMEI(mensagem) {
  // Protocolo J16/EC33 geralmente envia IMEI no início
  // Formato comum: *HQ,860262050123456,V1,143520,A,-3.745123,-38.567890...
  const match = mensagem.match(/\*HQ,(\d{15}),/);
  if (match) {
    return match[1];
  }

  // Tentar outros padrões comuns
  const imeiMatch = mensagem.match(/(\d{15})/);
  if (imeiMatch) {
    return imeiMatch[1];
  }

  return 'desconhecido';
}

// Função para interpretar mensagem do rastreador
function interpretarMensagem(mensagem, imei) {
  const msg = mensagem.toLowerCase().trim();

  // Respostas de confirmação
  if (msg.includes('set ok') || msg === 'ok') {
    return `IMEI:${imei} - ✅ set ok`;
  }

  if (msg.includes('set no ok') || msg.includes('error')) {
    return `IMEI:${imei} - ❌ set no ok`;
  }

  // Dados de status
  if (msg.includes('status') || msg.includes('szcs')) {
    return `IMEI:${imei} - 📊 STATUS: ${mensagem}`;
  }

  // Dados GPS (protocolo J16)
  if (msg.includes('*hq') || (msg.includes(',a,') || msg.includes(',v,'))) {
    return `IMEI:${imei} - 📍 GPS: ${mensagem}`;
  }

  // Heartbeat
  if (msg.includes('heartbeat') || msg.includes('online')) {
    return `IMEI:${imei} - 💓 heartbeat`;
  }

  // Comando WHERE resposta
  if (msg.includes('lat:') || msg.includes('lon:')) {
    return `IMEI:${imei} - 🗺️ LOCALIZAÇÃO: ${mensagem}`;
  }

  // Mensagem genérica
  return `IMEI:${imei} - 📡 ${mensagem}`;
}

// Servidor TCP para receber dados dos rastreadores J16/EC33
const tcpServer = net.createServer((socket) => {
  const clientIP = socket.remoteAddress;
  const clientPort = socket.remotePort;
  const connectionId = `${clientIP}:${clientPort}`;

  console.log(`📡 [TCP] Rastreador J16 conectado: ${connectionId}`);

  // Armazenar informações da conexão
  dispositivosConectados.set(connectionId, {
    socket: socket,
    ip: clientIP,
    port: clientPort,
    conectadoEm: new Date(),
    ultimaAtividade: new Date(),
    imei: null
  });

  // Broadcast da nova conexão
  broadcastToClients({
    tipo: 'resposta_rastreador',
    mensagem: `Dispositivo conectado: ${connectionId}`,
    hora: new Date().toLocaleTimeString()
  });

  socket.on('data', (data) => {
    try {
      const mensagem = data.toString().trim();
      const timestamp = new Date().toLocaleTimeString();

      // Extrair IMEI da mensagem
      const imei = extrairIMEI(mensagem);

      // Atualizar informações do dispositivo
      if (dispositivosConectados.has(connectionId)) {
        const dispositivo = dispositivosConectados.get(connectionId);
        dispositivo.imei = imei;
        dispositivo.ultimaAtividade = new Date();
        dispositivo.ultimaMensagem = mensagem;
      }

      // Interpretar mensagem
      const mensagemInterpretada = interpretarMensagem(mensagem, imei);

      console.log(`📱 [TCP] Recebido: ${mensagemInterpretada}`);

      // Enviar para todos os clientes WebSocket conectados
      broadcastToClients({
        tipo: 'resposta_rastreador',
        mensagem: mensagemInterpretada,
        hora: timestamp,
        mensagem_bruta: mensagem,
        imei: imei,
        connection_id: connectionId
      });

    } catch (error) {
      console.error('❌ [TCP] Erro ao processar mensagem:', error);
    }
  });

  socket.on('close', () => {
    console.log(`📡 [TCP] Rastreador desconectado: ${connectionId}`);

    // Remover da lista de dispositivos conectados
    dispositivosConectados.delete(connectionId);

    // Broadcast da desconexão
    broadcastToClients({
      tipo: 'resposta_rastreador',
      mensagem: `Dispositivo desconectado: ${connectionId}`,
      hora: new Date().toLocaleTimeString()
    });
  });

  socket.on('error', (error) => {
    console.error(`❌ [TCP] Erro na conexão ${connectionId}:`, error.message);
    dispositivosConectados.delete(connectionId);
  });
});

// WebSocket para comunicação com frontend
wss.on('connection', (ws) => {
  console.log('🌐 [WebSocket] Cliente conectado');

  // Enviar status inicial
  ws.send(JSON.stringify({
    tipo: 'tcp_status',
    mensagem: 'Conectado ao servidor TCP',
    hora: new Date().toLocaleTimeString(),
    dispositivos_conectados: dispositivosConectados.size
  }));

  ws.on('close', () => {
    console.log('🌐 [WebSocket] Cliente desconectado');
  });

  ws.on('error', (error) => {
    console.error('❌ [WebSocket] Erro:', error.message);
  });
});

// Endpoint para status TCP
app.get('/api/tcp/status', (req, res) => {
  const dispositivos = Array.from(dispositivosConectados.entries()).map(([id, info]) => ({
    id: id,
    ip: info.ip,
    port: info.port,
    imei: info.imei,
    conectado_em: info.conectadoEm,
    ultima_atividade: info.ultimaAtividade,
    ultima_mensagem: info.ultimaMensagem
  }));

  res.json({
    servidor_ativo: true,
    porta_tcp: process.env.PORT || 6809,
    dispositivos_conectados: dispositivosConectados.size,
    dispositivos: dispositivos,
    timestamp: new Date().toISOString()
  });
});

// Usar a mesma porta para HTTP, WebSocket e TCP
const PORT = process.env.PORT || 3000;

// Iniciar servidor HTTP/WebSocket
server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP/WebSocket rodando na porta ${PORT}`);
  console.log(`📱 Acesse: https://seu-projeto.onrender.com`);
  console.log(`🛠️  Health check: https://seu-projeto.onrender.com/api/health`);
  console.log(`📋 Comandos disponíveis: ${Object.keys(COMANDOS).length}`);
  console.log(`   - ${Object.keys(COMANDOS).join(', ')}`);
});

// Iniciar servidor TCP na mesma porta (Render só permite 1 porta)
tcpServer.listen(PORT, () => {
  console.log(`🔌 Servidor TCP para rastreadores J16 na porta ${PORT}`);
  console.log(`📡 Configure o rastreador: SERVER,1,SUA_URL.onrender.com,${PORT},0#`);
});

// Tratamento de erros do servidor TCP
tcpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log('⚠️  [TCP] Porta já em uso - isso é normal no Render');
  } else {
    console.error('❌ [TCP] Erro no servidor:', error.message);
  }
});

// Limpeza na finalização do processo
process.on('SIGINT', () => {
  console.log('\n🔄 Finalizando servidores...');

  // Fechar todas as conexões TCP
  dispositivosConectados.forEach((dispositivo, id) => {
    dispositivo.socket.destroy();
  });

  // Fechar servidores
  tcpServer.close();
  wss.close();
  server.close();

  process.exit(0);
});

console.log('📡 Sistema TCP/WebSocket para J16 inicializado');
console.log('   - Configuração do rastreador: SERVER,1,SUA_URL.onrender.com,PORTA,0#');
console.log('   - API Status: /api/tcp/status');
console.log('   - Aguardando respostas: set ok, set no ok, dados GPS, etc.');
