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
  'km': 'SZCS#GT06SEL=1#GT06METER=0'
};

// Página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Envio de SMS
app.post('/api/enviar', async (req, res) => {
  const { numero, comando, mensagem_custom } = req.body;

  if (!numero) {
    return res.status(400).json({ erro: 'Número é obrigatório' });
  }

  // Usar comando pré-definido ou personalizado
  const mensagem = mensagem_custom || COMANDOS[comando];

  if (!mensagem) {
    return res.status(400).json({ erro: 'Comando ou mensagem personalizada é obrigatória' });
  }

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
        campaign_id: `cmd_${Date.now()}`
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    res.json({
      sucesso: true,
      dados: response.data,
      numero: numero,
      mensagem: mensagem
    });

  } catch (error) {
    console.error('Erro:', error.response?.data || error.message);
    res.status(500).json({ 
      sucesso: false, 
      erro: 'Erro ao enviar SMS' 
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
    console.error('Erro:', error.response?.data || error.message);
    res.status(500).json({ erro: 'Erro ao consultar saldo' });
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
    console.error('Erro:', error.response?.data || error.message);
    res.status(500).json({ erro: 'Erro ao consultar período' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Acesse: http://localhost:${PORT}`);
});
