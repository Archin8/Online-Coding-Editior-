const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const cors = require("cors");
const path = require("path");

app.use(cors());

const server = http.createServer(app);

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
    console.log("username: ", username);
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
    if (roomId in roomID_to_Code_Map) {
      roomID_to_Code_Map[roomId].languageUsed = languageUsed;
    } else {
      roomID_to_Code_Map[roomId] = { languageUsed };
    }
  });

  socket.on("syncing the language", ({ roomId }) => {
    if (roomId in roomID_to_Code_Map) {
      socket.in(roomId).emit("on language change", { languageUsed: roomID_to_Code_Map[roomId].languageUsed });
    }
  });

  socket.on("update code", ({ roomId, code }) => {
    if (roomId in roomID_to_Code_Map) {
      roomID_to_Code_Map[roomId].code = code;
    } else {
      roomID_to_Code_Map[roomId] = { code };
    }
  });

  socket.on("syncing the code", ({ roomId }) => {
    if (roomId in roomID_to_Code_Map) {
      socket.in(roomId).emit("on code change", { code: roomID_to_Code_Map[roomId].code });
    }
  });

  socket.on("leave room", ({ roomId }) => {
    socket.leave(roomId);
    updateUserslistAndCodeMap(io, socket, roomId);
  });

  socket.on("disconnecting", async () => {
    for (const eachRoom of socket.rooms) {
      if (eachRoom in roomID_to_Code_Map) {
        await updateUserslistAndCodeMap(io, socket, eachRoom);
      }
    }
  });

  socket.on('disconnect', function () {
    console.log('A user disconnected');
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, function () {
  console.log(`listening on port : ${PORT}`);
});
