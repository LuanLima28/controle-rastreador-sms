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
app.use(bodyParser.urlencoded({ extended: true })); // Para receber dados do rastreador
app.use(express.static(__dirname));

// Comandos específicos solicitados
const COMANDOS = {
  'fuso': 'GMT,W,0,0#',
  'apn_vivo': 'APN,wl.vivo.com.br,vivo,vivo#',
  'servidor': 'SERVER,0,144.202.13.234,6809,0#',
  'servidor_callback': 'URL,10,controle-rastreador-sms.onrender.com/callback#',
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
    callback_ativo: true,
    callback_url: 'https://controle-rastreador-sms.onrender.com/callback'
  });
});

// ====================================
// HTTP CALLBACK - RECEBER RESPOSTAS DO RASTREADOR J16
// ====================================

const WebSocket = require('ws');
const http = require('http');

// Criar servidor HTTP para compartilhar porta com Express
const server = http.createServer(app);

// WebSocket para comunicação em tempo real com frontend
const wss = new WebSocket.Server({ server });

// Armazenar histórico de mensagens
const historicoMensagens = [];

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

  // Procurar em parâmetros da URL
  if (typeof mensagem === 'object' && mensagem.imei) {
    return mensagem.imei;
  }
  
  return 'desconhecido';
}

// Função para interpretar mensagem do rastreador
function interpretarMensagem(mensagem, imei) {
  if (typeof mensagem === 'object') {
    mensagem = JSON.stringify(mensagem);
  }
  
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

// ====================================
// ENDPOINT CALLBACK - RECEBER DADOS DO RASTREADOR
// ====================================

// Callback HTTP - Rastreador envia dados via POST
app.post('/callback', (req, res) => {
  try {
    const timestamp = new Date().toLocaleTimeString();
    let dadosRecebidos = '';
    
    // Capturar dados do body (JSON ou form-data)
    if (req.body && Object.keys(req.body).length > 0) {
      dadosRecebidos = req.body;
    } else {
      dadosRecebidos = 'Dados recebidos via callback';
    }
    
    console.log(`📱 [HTTP CALLBACK] Dados recebidos:`, dadosRecebidos);
    
    // Extrair IMEI
    const imei = extrairIMEI(dadosRecebidos);
    
    // Interpretar mensagem
    const mensagemInterpretada = interpretarMensagem(dadosRecebidos, imei);
    
    // Salvar no histórico
    const registro = {
      timestamp: new Date(),
      imei: imei,
      mensagem_original: dadosRecebidos,
      mensagem_interpretada: mensagemInterpretada,
      ip: req.ip
    };
    
    historicoMensagens.push(registro);
    
    // Manter apenas últimas 100 mensagens
    if (historicoMensagens.length > 100) {
      historicoMensagens.shift();
    }
    
    console.log(`📱 [CALLBACK] Processado: ${mensagemInterpretada}`);
    
    // Enviar para clientes WebSocket
    broadcastToClients({
      tipo: 'resposta_rastreador',
      mensagem: mensagemInterpretada,
      hora: timestamp,
      mensagem_bruta: dadosRecebidos,
      imei: imei,
      ip: req.ip
    });
    
    // Responder OK para o rastreador
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('❌ [CALLBACK] Erro ao processar:', error);
    res.status(500).send('ERROR');
  }
});

// Callback HTTP via GET (alguns rastreadores usam GET)
app.get('/callback', (req, res) => {
  try {
    const timestamp = new Date().toLocaleTimeString();
    const dadosRecebidos = req.query;
    
    console.log(`📱 [HTTP CALLBACK GET] Dados recebidos:`, dadosRecebidos);
    
    // Extrair IMEI
    const imei = extrairIMEI(dadosRecebidos);
    
    // Interpretar mensagem
    const mensagemInterpretada = interpretarMensagem(dadosRecebidos, imei);
    
    // Salvar no histórico
    const registro = {
      timestamp: new Date(),
      imei: imei,
      mensagem_original: dadosRecebidos,
      mensagem_interpretada: mensagemInterpretada,
      ip: req.ip
    };
    
    historicoMensagens.push(registro);
    
    console.log(`📱 [CALLBACK GET] Processado: ${mensagemInterpretada}`);
    
    // Enviar para clientes WebSocket
    broadcastToClients({
      tipo: 'resposta_rastreador',
      mensagem: mensagemInterpretada,
      hora: timestamp,
      mensagem_bruta: dadosRecebidos,
      imei: imei,
      ip: req.ip
    });
    
    // Responder OK para o rastreador
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('❌ [CALLBACK GET] Erro ao processar:', error);
    res.status(500).send('ERROR');
  }
});

// WebSocket para comunicação com frontend
wss.on('connection', (ws) => {
  console.log('🌐 [WebSocket] Cliente conectado');
  
  // Enviar status inicial
  ws.send(JSON.stringify({
    tipo: 'callback_status',
    mensagem: 'Callback HTTP ativo',
    hora: new Date().toLocaleTimeString(),
    total_mensagens: historicoMensagens.length
  }));
  
  // Enviar últimas mensagens do histórico
  historicoMensagens.slice(-10).forEach(registro => {
    ws.send(JSON.stringify({
      tipo: 'resposta_rastreador',
      mensagem: registro.mensagem_interpretada,
      hora: registro.timestamp.toLocaleTimeString(),
      imei: registro.imei
    }));
  });
  
  ws.on('close', () => {
    console.log('🌐 [WebSocket] Cliente desconectado');
  });
  
  ws.on('error', (error) => {
    console.error('❌ [WebSocket] Erro:', error.message);
  });
});

// Endpoint para status do callback
app.get('/api/callback/status', (req, res) => {
  res.json({
    callback_ativo: true,
    callback_url: 'https://controle-rastreador-sms.onrender.com/callback',
    total_mensagens_recebidas: historicoMensagens.length,
    ultimas_mensagens: historicoMensagens.slice(-5),
    timestamp: new Date().toISOString()
  });
});

// Endpoint para ver histórico
app.get('/api/callback/historico', (req, res) => {
  res.json({
    total: historicoMensagens.length,
    mensagens: historicoMensagens.slice(-50) // Últimas 50
  });
});

const PORT = process.env.PORT || 3000;

// Iniciar servidor HTTP/WebSocket
server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP/WebSocket rodando na porta ${PORT}`);
  console.log(`📱 URL: https://controle-rastreador-sms.onrender.com`);
  console.log(`🔗 Callback URL: https://controle-rastreador-sms.onrender.com/callback`);
  console.log(`🛠️  Health check: https://controle-rastreador-sms.onrender.com/api/health`);
  console.log(`📋 Comandos disponíveis: ${Object.keys(COMANDOS).length}`);
  console.log(`   - ${Object.keys(COMANDOS).join(', ')}`);
});

console.log('📡 Sistema HTTP Callback para J16 inicializado');
console.log('   - Configure o rastreador: URL,10,controle-rastreador-sms.onrender.com/callback#');
console.log('   - Callback recebe via POST e GET');
console.log('   - Aguardando respostas: set ok, set no ok, dados GPS, etc.');
