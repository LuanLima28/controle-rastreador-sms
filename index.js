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
    comandos_disponiveis: Object.keys(COMANDOS)
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Acesse: http://localhost:${PORT}`);
  console.log(`🛠️  Health check: http://localhost:${PORT}/api/health`);
  console.log(`📋 Comandos disponíveis: ${Object.keys(COMANDOS).length}`);
  console.log(`   - ${Object.keys(COMANDOS).join(', ')}`);
});
