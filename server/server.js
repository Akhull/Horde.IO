import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// Beispielhafte Map-Daten – in einer realen Anwendung aus Datenbank oder dynamischer Generierung
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
  map: generateMap()
};

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('playerJoined', (data) => {
    // Aufnahme des Spielers im globalen Zustand
    gameState.players[socket.id] = {
      id: socket.id,
      x: data.x,
      y: data.y,
      faction: data.faction,
      hp: 100,
      ready: false // Noch nicht bereit, bis der Charakter ausgewählt wurde
    };
    // Sende dem neuen Spieler den aktuellen Zustand
    socket.emit('stateUpdate', gameState);
    // Informiere alle anderen über den neuen Spieler
    socket.broadcast.emit('newPlayer', gameState.players[socket.id]);
  });
  
  socket.on('characterSelected', (data) => {
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].faction = data.faction;
      // Markiere den Spieler als bereit
      gameState.players[socket.id].ready = true;
      console.log(`Player ${socket.id} hat ${data.faction} ausgewählt und ist bereit.`);
    }
  });
  
  socket.on('lobbyReady', () => {
    console.log(`Player ${socket.id} signalisiert Lobby-Bereitschaft.`);
    // Prüfe, ob mindestens 2 Spieler verbunden sind und alle bereit sind
    let allReady = Object.values(gameState.players).every(player => player.ready);
    if (Object.keys(gameState.players).length >= 2 && allReady) {
      console.log("Alle Spieler sind bereit. Starte das Spiel.");
      io.emit('startGame');
    }
  });
  
  socket.on('playerMoved', (data) => {
    if(gameState.players[socket.id]){
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

server.listen(8080, () => {
  console.log('Server listening on port 8080');
});
