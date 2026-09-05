import cors from 'cors';
import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { executeCode, checkImages } from './executeCode.js';

const app = express();
const server = http.createServer(app);

// Allow cross-origin requests from frontend
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
  });
}

app.get('/', function (req, res) {
  res.send('Hello from the server!');
});

// Code execution endpoint
app.post('/api/execute', async (req, res) => {
  const { code, language } = req.body;

  if (!code || !language) {
    return res.status(400).json({
      output: '',
      error: 'Both "code" and "language" fields are required.',
      exitCode: 1,
      executionTime: 0,
      timedOut: false,
    });
  }

  try {
    const result = await executeCode(code, language);
    res.json(result);
  } catch (err) {
    console.error('Code execution error:', err);
    res.status(500).json({
      output: '',
      error: `Server error: ${err.message}`,
      exitCode: 1,
      executionTime: 0,
      timedOut: false,
    });
  }
});

// Check which Docker images are available
app.get('/api/images', async (req, res) => {
  try {
    const images = await checkImages();
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const socketID_to_Users_Map = {};
const roomID_to_Code_Map = {};

async function getUsersinRoom(roomId, io) {
  const socketList = await io.in(roomId).allSockets();
  const userslist = [];
  socketList.forEach((each) => {
    if (each in socketID_to_Users_Map) {
      userslist.push(socketID_to_Users_Map[each].username);
    }
  });
  return userslist;
}

async function updateUserslistAndCodeMap(io, socket, roomId) {
  socket.in(roomId).emit("member left", { username: socketID_to_Users_Map[socket.id]?.username });
  delete socketID_to_Users_Map[socket.id];
  const userslist = await getUsersinRoom(roomId, io);
  socket.in(roomId).emit("updating client list", { userslist });

  if (userslist.length === 0) {
    delete roomID_to_Code_Map[roomId];
  }
}

io.on('connection', function (socket) {
  console.log('A user connected', socket.id);

  socket.on("when a user joins", async ({ roomId, username }) => {
    socketID_to_Users_Map[socket.id] = { username };
    socket.join(roomId);

    const userslist = await getUsersinRoom(roomId, io);
    socket.in(roomId).emit("updating client list", { userslist });
    io.to(socket.id).emit("updating client list", { userslist });

    if (roomId in roomID_to_Code_Map) {
      io.to(socket.id).emit("on language change", { languageUsed: roomID_to_Code_Map[roomId].languageUsed });
      io.to(socket.id).emit("on code change", { code: roomID_to_Code_Map[roomId].code });
    }

    socket.in(roomId).emit("new member joined", { username });
  });

  socket.on("update language", ({ roomId, languageUsed }) => {
    roomID_to_Code_Map[roomId] = {
      ...roomID_to_Code_Map[roomId],
      languageUsed
    };
  });

  socket.on("syncing the language", ({ roomId }) => {
    if (roomID_to_Code_Map[roomId]) {
      socket.in(roomId).emit("on language change", { languageUsed: roomID_to_Code_Map[roomId].languageUsed });
    }
  });

  socket.on("update code", ({ roomId, code }) => {
    roomID_to_Code_Map[roomId] = {
      ...roomID_to_Code_Map[roomId],
      code
    };
  });

  socket.on("syncing the code", ({ roomId }) => {
    if (roomID_to_Code_Map[roomId]) {
      socket.in(roomId).emit("on code change", { code: roomID_to_Code_Map[roomId].code });
    }
  });

  socket.on("leave room", ({ roomId }) => {
    socket.leave(roomId);
    updateUserslistAndCodeMap(io, socket, roomId);
  });

  socket.on("disconnecting", () => {
    socket.rooms.forEach((eachRoom) => {
      if (eachRoom in roomID_to_Code_Map) {
        updateUserslistAndCodeMap(io, socket, eachRoom);
      }
    });
  });

  socket.on('disconnect', function () {
    console.log('A user disconnected');
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, function () {
  console.log(`listening on port : ${PORT}`);
});
