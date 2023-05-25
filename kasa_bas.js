// REQUIREMENTS
var PDFDocument = require("pdfkit");
var qr = require("qr-image");
var shell = require("shelljs");
var fs = require("fs");
var express = require("express");
var bodyParser = require("body-parser");
var http = require("http");
var cors = require("cors");
var socketIO = require("socket.io");
var axios = require('axios');
var Sequelize = require('sequelize');
const macaddress = require("macaddress");

// VARIABLES
let TERMINAL_KODU = "";
let lokasyon = "D1";

var ServerIP = function () {
  if (lokasyon == "D1") {
    return "10.46.5.112";
  } else if (lokasyon == "D2") {
    return "10.45.1.111";
  }
}();

var serviceURL = function () {
  if (lokasyon == "D1") {
    return "http://10.46.5.112:3001";
  } else if (lokasyon == "D2") {
    return "http://10.45.1.111:3001";
  }
}();

const sequelize_uvt = new Sequelize('uretim', 'root', '5421', {
  host: ServerIP,
  dialect: 'mysql',
  timezone: '+03:00',
  logging: false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// ***********************************************************
// ***********************************************************
// APP CONFIGS
// ***********************************************************
// ***********************************************************
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// ***********************************************************
// ***********************************************************
// SERVER CONFIGS
// ***********************************************************
// ***********************************************************
let server = http.createServer(app);
server.listen(4001, () => console.log(`Listening on port 4001`));

// ***********************************************************
// ***********************************************************
// IO CONFIGS
// ***********************************************************
// ***********************************************************
let io = socketIO(server, {
  cors: {
    "origin": "*",
    "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
    "preflightContinue": false,
    "optionsSuccessStatus": 204
  }
});

io.on("connection", (socket) => {
  console.log("io.on => connection");

  socket.on("disconnect", () => {
    console.log("socket.on => disconnect");
  });
});

app.post("/printKasaEtiketi", async (req, res) => {
  console.log("app.post => /printKasaEtiketi");

  try {
    let barkod = req.body.barkod;

    if (!barkod) {
      throw "Barkod boş olamaz!";
    }

    let personelData = await getPersonelService(barkod);

    if (!personelData || !personelData.ADI_SOYADI || !personelData.SICIL) {
      await emitMessage({
        text: `Maalesef sizi tanıyamadım`,
        icon: "frown"
      });

      return res.status(200).json();
    }

    let personelAdi = personelData["ADI_SOYADI"];
    personelAdi = titleCase(personelAdi.split(" ")[0]);

    await emitMessage({
      text: `Merhaba ${personelAdi},<br/>Kasa etiketlerini kontrol ediyorum`,
      icon: "smile-beam"
    });

    let kasaEtiketleri = await getKasaEtiketleriService(personelData["SICIL"]);

    if (!kasaEtiketleri || kasaEtiketleri.length === 0) {
      emitMessage({
        text: `Çıktı bekleyen kasa etiketi bulunmamaktadır!`,
        icon: "frown"
      });
      return res.status(200).json();
    }

    emitMessage({
      text: `Toplam ${kasaEtiketleri.length} adet etiket bulundu. Çıktı alınıyor...`,
      icon: "smile-beam"
    });

    shell.exec("cupsenable KASA");
    shell.exec('sudo find . -name "kasa*.pdf" -exec rm {} +');
    shell.exec('cancel -a KASA');

    kasaEtiketleri.map(async (kasaEtiketi, index) => {
      await kasa_bas(kasaEtiketi, index);
      await updatePrintTime(kasaEtiketi.ID);
    });

    emitMessage({
      text: `İşlem tamamlandı`,
      icon: "smile-beam"
    });

    res.status(200).json();

  } catch (err) {
    console.error(err.message || err);
    res.status(400).json(err);
  }

});

app.post("/", async (req, res) => {
  console.log("app.post => /");

  try {
    let barkod = req.body.barkod;

    if (!barkod) {
      throw "Barkod boş olamaz!";
    }

    let kasaEtiketleri = await getKasaEtiketleriService(barkod);

    if (!kasaEtiketleri || kasaEtiketleri.length === 0) {
      throw "çıktı bekleyen kasa etiketi bulunamadı!";
    }


    shell.exec("cupsenable KASA");
    shell.exec('sudo find . -name "kasa*.pdf" -exec rm {} +');
    shell.exec('cancel -a KASA');

    kasaEtiketleri.map(async (kasaEtiketi, index) => {
      await kasa_bas(kasaEtiketi, index);
      await updatePrintTime(kasaEtiketi.ID);
    });


    res.status(200).json();

  } catch (err) {
    console.error(err.message || err);
    res.status(400).json(err);
  }

});

setInterval(syncConfig, 1 * 60 * 1000);

async function kasa_bas(kasaEtiketi, index) {
  console.log("calling function => kasa_bas");

  try {
    let ISEMRI_NO = kasaEtiketi.ISEMRI_NO;
    let PARCA_NO = kasaEtiketi.PARCA_NO;
    let MIKTAR = kasaEtiketi.MIKTAR;
    let PARCA_TANIM = kasaEtiketi.PARCA_TANIM;
    let TASIYICI = kasaEtiketi.TASIYICI;
    let KASA_NO_TEXT = kasaEtiketi.KASA_NO_TEXT;
    let ISCI_SICIL = kasaEtiketi.ISCI_SICIL;
    let ISCI = kasaEtiketi.ISCI;
    let CIKTI_ZAMANI = kasaEtiketi.CIKTI_ZAMANI;
    let KASA_BARKOD = kasaEtiketi.KASA_BARKOD;

    let ISEMRI_NO_qr = qr.imageSync(ISEMRI_NO);
    let PARCA_NO_qr = qr.imageSync(PARCA_NO);
    let MIKTAR_qr = qr.imageSync(MIKTAR);
    let KASA_qr = qr.imageSync(KASA_BARKOD);

    let pdf = new PDFDocument({
      size: "A4"
    });

    pdf.registerFont("NotoSans", "NotoSans-Regular.ttf");
    pdf.font("NotoSans");

    pdf.image("kasa_v2.png", {
      x: 0,
      y: 0,
      width: 600,
      fit: [100, 100],
      align: "left",
    });

    // BARCODE POSITIONS
    pdf.image(ISEMRI_NO_qr, {
      x: 350,
      y: 20,
      width: 60,
      fit: [60, 60],
    });
    pdf.image(PARCA_NO_qr, {
      x: 500,
      y: 90,
      width: 60,
      fit: [60, 60],
    });
    pdf.image(MIKTAR_qr, {
      x: 500,
      y: 200,
      width: 40,
      fit: [40, 40],
    });
    pdf.image(KASA_qr, {
      x: 500,
      y: 280,
      width: 60,
      fit: [60, 60],
    });

    // TEXT POSITIONS
    pdf.fontSize(18).text(ISEMRI_NO, 110, 35);
    pdf.fontSize(32).text(PARCA_NO, 110, 95);
    pdf.fontSize(12).text(PARCA_TANIM, 110, 170);
    pdf.fontSize(18).text(MIKTAR, 110, 210);
    pdf.fontSize(12).text(TASIYICI, 110, 250);
    pdf.fontSize(30).text(KASA_NO_TEXT, 110, 295);
    pdf.fontSize(10).text(ISCI_SICIL, 110, 360);
    pdf.fontSize(10).text(ISCI, 110, 380);
    pdf.fontSize(10).text(CIKTI_ZAMANI, 430, 372);

    const stream = pdf.pipe(fs.createWriteStream(`kasa-${ISEMRI_NO}-${index}.pdf`));

    pdf.end();

    stream.on("finish", function () {
      shell.exec("cupsenable KASA");
      shell.exec(`lpr -P KASA 'kasa-${ISEMRI_NO}-${index}.pdf'`);
    });

    return "OK";

  } catch (err) {
    throw err.message || err;
  }
};

async function updatePrintTime(ID) {
  console.log("calling function => updatePrintTime");

  let temp = await sequelize_uvt.query("UPDATE kasa_etiketleri SET printTime = NOW () WHERE ID = :ID", {
    type: sequelize_uvt.QueryTypes.UPDATE,
    replacements: {
      ID: ID
    }
  });

  return temp;
}

async function syncConfig() {
  console.log("calling function => syncConfig");

  let IP = await checkIP();

  let temp = await sequelize_uvt.query("UPDATE terminal_list SET IP = :IP, MAC = :MAC WHERE TERMINAL_KODU = :TERMINAL_KODU", {
    type: sequelize_uvt.QueryTypes.UPDATE,
    replacements: {
      TERMINAL_KODU: TERMINAL_KODU,
      IP: IP["ipv4"] || null,
      MAC: IP["mac"] || null
    }
  });

  return temp;
}

async function checkIP() {
  console.log("calling function => checkIP");

  let IP = {};
  let allAddress = await macaddress.all();

  if (allAddress) {
    allAddress = Object.values(allAddress);

    allAddress = allAddress.filter((element) => {
      if (element.ipv4 && element.ipv4.startsWith("10.")) {
        return element;
      }
    });

    IP = allAddress[0] || {};
  }

  return IP;
}

async function getPersonelService(barkod) {
  console.log("calling function => getPersonelService");

  let data = null;

  await axios
    .post(serviceURL + "/GetWorker", {
      TEXT: barkod,
    }).then(results => {
      data = results.data[0];
    })
    .catch((err) => {
      console.error(axiosError(err));
    });

  return data;
}

async function getKasaEtiketleriService(sicilNo) {
  console.log("calling function => getKasaEtiketleriService");

  let data = null;

  await axios
    .post(serviceURL + "/GetKasaEtiketleri", {
      sicilNo: sicilNo,
    }).then(results => {
      data = results.data;
    })
    .catch((err) => {
      console.error(axiosError(err));
    });

  return data;

}

function emitMessage(message) {
  console.log("calling function => emitMessage");

  return new Promise((resolve) => {
    io.sockets.emit("setMessage", message);

    setTimeout(() => {
      resolve();
    }, 1000 * 3);

  });

}

function titleCase(string) {
  console.log("calling function => titleCase");

  let sentence = string.toLowerCase().split(" ");

  for (var i = 0; i < sentence.length; i++) {
    sentence[i] = sentence[i][0].toUpperCase() + sentence[i].slice(1);
  }

  return sentence;
}

function axiosError(error) {
  console.log("calling function => axiosError");

  let message = null;

  if (error.response) {
    if (error.response.data.name == "SequelizeDatabaseError") {
      message = error.response.data.original.message;
    } else {
      message = error.response.data;
    }
  } else if (error.request) {
    message = error.request;
  } else {
    message = error.message;
  }

  return message;
}