import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { MapGenerator } from './MapGenerator.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// Generate map once when server starts
const mapData = MapGenerator.generateMap();

let gameState = {
  players: {},
  map: mapData,
  inCharacterSelection: false
};

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send the map data immediately upon connection (or with initial state)
  socket.emit('mapData', gameState.map);

  socket.on('playerJoined', (data) => {
    gameState.players[socket.id] = {
      id: socket.id,
      x: data.x,
      y: data.y,
      faction: data.faction,
      hp: 100,
      ready: false, // noch nicht bereit – wartet auf Charakterauswahl
      units: [] // Array to hold this player's unit data
    };
    socket.emit('stateUpdate', gameState); // Consider trimming map from this if it's huge and static
    socket.broadcast.emit('newPlayer', gameState.players[socket.id]);
    
    // Sobald mindestens zwei Spieler verbunden sind und wir noch nicht in der Charakterauswahl sind,
    // weise den Zustand zu und sende das Event an alle Clients.
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
    // Falls der Spieler noch nicht als ready markiert wurde, setze ihn hier
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

  socket.on('updateArmy', (unitsData) => {
    if (gameState.players[socket.id]) {
      // unitsData should be array of { id, type, x, y, hp, level }
      gameState.players[socket.id].units = unitsData;
    }
  });

  socket.on('shoot', (projectileData) => {
      // Broadcast shooting event to all other clients
      socket.broadcast.emit('shoot', projectileData);
  });

  socket.on('hit', (hitData) => {
      // Broadcast hit event
      socket.broadcast.emit('hit', hitData);
  });

  socket.on('playerDied', () => {
      console.log(`Player ${socket.id} died.`);
      if (gameState.players[socket.id]) {
          gameState.players[socket.id].dead = true;
      }

      // Check for winner
      const alivePlayers = Object.values(gameState.players).filter(p => !p.dead && p.ready);
      if (alivePlayers.length === 1 && Object.keys(gameState.players).length > 1) {
          // We have a winner
          io.emit('gameOver', { winnerId: alivePlayers[0].id, winnerFaction: alivePlayers[0].faction });
      } else if (alivePlayers.length === 0 && Object.keys(gameState.players).length > 0) {
          // All dead?
          io.emit('gameOver', { winnerId: null, message: "Draw" });
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
  // We can optimize this by not sending the static map every time
  const updatePacket = {
      players: gameState.players,
      inCharacterSelection: gameState.inCharacterSelection
  };
  io.emit('stateUpdate', updatePacket);
}, 100);

server.listen(8080, () => {
  console.log('Server listening on port 8080');
});
