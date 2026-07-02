const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
const UPDATE_INTERVAL = 10000;

let auctionCache = {
    lots: [],
    lastUpdate: null,
    totalLots: 0
};

let connectedClients = [];

app.use(express.static(path.join(__dirname, 'public')));

async function fetchAuctionData() {
    try {
        const response = await axios.get('https://stalcraftapi.ru/auction/all', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        if (response.data && Array.isArray(response.data)) {
            auctionCache.lots = response.data;
            auctionCache.lastUpdate = new Date().toISOString();
            auctionCache.totalLots = response.data.length;
            
            broadcastUpdate(auctionCache);
            console.log(`[${new Date().toLocaleTimeString()}] Обновлено: ${response.data.length} лотов`);
        }
    } catch (error) {
        console.error('Ошибка получения данных:', error.message);
        
        try {
            const response = await axios.get('https://stalcraftdb.com/api/auction', {
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                },
                timeout: 10000
            });

            if (response.data) {
                const lots = Array.isArray(response.data) ? response.data : response.data.items || [];
                auctionCache.lots = lots;
                auctionCache.lastUpdate = new Date().toISOString();
                auctionCache.totalLots = lots.length;
                broadcastUpdate(auctionCache);
            }
        } catch (backupError) {
            console.error('Резервный источник тоже недоступен:', backupError.message);
        }
    }
}

function broadcastUpdate(data) {
    const message = JSON.stringify({
        type: 'auction_update',
        data: data,
        timestamp: Date.now()
    });

    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('Новый клиент подключен');
    connectedClients.push(ws);

    if (auctionCache.lots.length > 0) {
        ws.send(JSON.stringify({
            type: 'auction_update',
            data: auctionCache,
            timestamp: Date.now()
        }));
    }

    ws.on('close', () => {
        connectedClients = connectedClients.filter(client => client !== ws);
        console.log('Клиент отключен');
    });

    ws.on('error', (error) => {
        console.error('Ошибка WebSocket:', error.message);
        connectedClients = connectedClients.filter(client => client !== ws);
    });
});

app.get('/api/auction', (req, res) => {
    res.json(auctionCache);
});

app.get('/api/search', (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    const category = req.query.category?.toLowerCase() || '';
    
    let filtered = auctionCache.lots;

    if (query) {
        filtered = filtered.filter(lot => 
            lot.name?.toLowerCase().includes(query) ||
            lot.item_name?.toLowerCase().includes(query)
        );
    }

    if (category) {
        filtered = filtered.filter(lot => 
            lot.category?.toLowerCase() === category ||
            lot.type?.toLowerCase() === category
        );
    }

    res.json({
        lots: filtered,
        total: filtered.length,
        lastUpdate: auctionCache.lastUpdate
    });
});

fetchAuctionData();
setInterval(fetchAuctionData, UPDATE_INTERVAL);

server.listen(PORT, () => {
    console.log(`Сервер аукциона STALZONE запущен на http://localhost:${PORT}`);
});
