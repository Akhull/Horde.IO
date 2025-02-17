// public/server/server.js
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);
const PORT = process.env.PORT || 8080;

// __dirname in ES Modules definieren
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bestimme den Pfad zum übergeordneten Ordner "public"
const publicPath = path.join(__dirname, '..', 'public');
console.log("Static files served from:", publicPath);

// Statische Dateien aus dem "public"-Ordner bereitstellen
app.use(express.static(publicPath));

// Sende index.html als Startseite (liegt unter public/index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Beispielhafte Map-Daten (könnten dynamisch generiert werden)
function generateMap() {
  return {
    buildings: [
      { id: 1, x: 500, y: 300, type: 'house' },
      { id: 2, x: 1200, y: 800, type: 'castle' }
    ],
    obstacles: [
      { id: 1, x: 800, y: 600, type: 'rock' },
      { id: 2, x: 1000, y: 400, type: 'tree' }
    ]
  };
}

let gameState = {
  players: {},
  map: generateMap(),
  inCharacterSelection: false
};

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('playerJoined', (data) => {
    gameState.players[socket.id] = {
      id: socket.id,
      x: data.x,
      y: data.y,
      faction: data.faction,
      hp: 100,
      ready: false // wartet auf Charakterauswahl
    };
    socket.emit('stateUpdate', gameState);
    socket.broadcast.emit('newPlayer', gameState.players[socket.id]);
    
    if (Object.keys(gameState.players).length >= 2 && !gameState.inCharacterSelection) {
      gameState.inCharacterSelection = true;
      io.emit('showCharacterSelection');
      console.log("Mindestens 2 Spieler verbunden. Sende 'showCharacterSelection'.");
    }
  });
  
  socket.on('characterSelected', (data) => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].faction = data.faction;
      gameState.players[socket.id].ready = true;
      console.log(`Player ${socket.id} hat ${data.faction} ausgewählt und ist bereit.`);
    }
  });
  
  socket.on('lobbyReady', () => {
    if (gameState.players[socket.id] && !gameState.players[socket.id].ready) {
      gameState.players[socket.id].ready = true;
      console.log(`Player ${socket.id} wurde in lobbyReady als bereit markiert.`);
    }
    console.log(`Player ${socket.id} signalisiert Lobby-Bereitschaft.`);
    let allReady = Object.values(gameState.players).every(player => player.ready);
    if (Object.keys(gameState.players).length >= 2 && allReady) {
      console.log("Alle Spieler sind bereit. Starte das Spiel.");
      io.emit('startGame');
    } else {
      console.log("Noch nicht alle Spieler sind bereit.");
    }
  });
  
  socket.on('playerMoved', (data) => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].x = data.x;
      gameState.players[socket.id].y = data.y;
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    delete gameState.players[socket.id];
    socket.broadcast.emit('playerDisconnected', socket.id);
  });
});

// Sende 10-mal pro Sekunde den aktuellen Zustand an alle Clients
setInterval(() => {
  io.emit('stateUpdate', gameState);
}, 100);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
