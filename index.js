//CONFIGS
const VERSION = '23.05.22-VW';
const lokasyon = 'D1'; // D1 veya D2 olacak!!!
const onceki_operasyon = '0';

// ***********************************************************
// ***********************************************************
// REQUIREMENTS
// ***********************************************************
// ***********************************************************
const SerialPort = require('serialport');
const axios = require('axios');
const http = require('http');
const express = require('express');
const snap7 = require('node-snap7');
const socketIO = require('socket.io');
const fs = require('fs');
const moment = require('moment');
const async = require('async');
const GPIO = require('onoff').Gpio;
const cors = require('cors');
const macaddress = require('macaddress');
const pad = require('pad');
const bodyParser = require('body-parser');
const Sequelize = require('sequelize');
const _ = require('lodash');
const os = require('os');
const exec = require('child_process').exec;
const net = require('net');

// ***********************************************************
// ***********************************************************
// VARIABLE GLOBAL PARAMETERS
// ***********************************************************
// ***********************************************************
let digital = '0'; // PLC'den okunan son değerin tutulduğu değişken...
let connections = []; // view soket bağlantılarının tutulduğu array
let uretimKalanSureSn = 0; // tekrardan parça etiketi alabilmek için gerekli olan sürenin tutulduğu değişken
let kasaEtiketiKalanSureSn = 0; // tekrardan kasa etiketi alabilmek için gerekli olan sürenin tutulduğu değişken
let kasaEtiketiSureSiniriSn = 60;
let uretimSureSiniriSn = 0;
let SERVER_IP_D1 = '10.46.5.112';
let SERVER_IP_D2 = '10.45.1.111';
let SERVER_API_D1 = 'http://10.46.5.112:3001';
let SERVER_API_D2 = 'http://10.45.1.111:3001';
let KALITE_KONTROL_SERVICE =
	'http://10.45.1.111:4250/kaliteSeriBaslangicKontrol';
let LOCAL_KASA_BAS_SERVICE = 'http://localhost:4001';
let port; // barkod okuyucu bağantı bilgisi tutuluyor
let ENJ; //0  ENJ1 Kraus 3 PLC Bankolar 4 Barkod Okuyucu
let prevBarkod = '';
let kaliteKontroluYapilsinMi; // 0 => Hayır, 1 => Evet
let kasaEtiketiDogrudanYazdir = 1; // 0 => Sunucu bağlantılı olarak personel kartı okutularak çıktı alınır. 1 => Tablet-Yazıcı arası bağlantı üzerinden direk yazdırılır.
let toleransCarpani = 0;
axios.defaults.timeout === 30 * 1000;

var ServerIP = (function () {
	if (lokasyon == 'D1') {
		return SERVER_IP_D1;
	} else if (lokasyon == 'D2') {
		return SERVER_IP_D2;
	}
})();

var ServerURL = (function () {
	if (lokasyon == 'D1') {
		return SERVER_API_D1;
	} else if (lokasyon == 'D2') {
		return SERVER_API_D2;
	}
})();

var s7client = new snap7.S7Client();

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
let server = http.Server(app);
server.listen(4000, () => console.log(`Listening on port 4000`));

// ***********************************************************
// ***********************************************************
// IO CONFIGS
// ***********************************************************
// ***********************************************************
let io = new socketIO(server);
io.sockets.on('connection', (socket) => {
	connections.push(socket);
	console.log(' %s sockets is connected', connections.length);
	configUpdate();

	socket.on('disconnect', () => {
		connections.splice(connections.indexOf(socket), 1);
	});

	socket.on('printKasaEtiketi', (data) => {
		kasa_bas(data);
	});

	socket.on('sicilCikis', () => {
		sicilCikis();
	});
});

// ***********************************************************
// ***********************************************************
// OTHER CONFIGS
// ***********************************************************
let led = new GPIO(17, 'out');
let button = new GPIO(20, 'in', 'both');
let button2 = new GPIO(16, 'in', 'both');

process.on('SIGINT', function () {
	led.unexport();
	button.unexport();
	button2.unexport();
});

// ***********************************************************
// ***********************************************************
// SEQUEALIZE CONFIGS
// ***********************************************************
// ***********************************************************
var sequelize_local = new Sequelize('sqlite:/home/pi/Server/uvt.db', {
	dialect: 'sqlite',
	storage: '/home/pi/Server/uvt.db',
	benchmark: true,
	logging: false,
});

const sequelize_mysql = new Sequelize('uretim', 'root', '5421', {
	host: ServerIP,
	dialect: 'mysql',
	timezone: '+03:00',
	logging: false,
	pool: {
		max: 10,
		min: 0,
		acquire: 30000,
		idle: 10000,
	},
});

sequelize_local
	.authenticate()
	.then(() => {
		// CREATE TABLE
		sequelize_local
			.query(
				'CREATE TABLE if not exists  ISEMIRLERI ( ISEMRI_NO TEXT, ISEMRI_MIK TEXT, URETILEN_MIK TEXT, BAKIYE TEXT, STOK_NO TEXT, MLZ_ADI TEXT, DOSYA_YERI TEXT, ISE_UREMIK INTEGER, ISE_BAKIYE INTEGER, RECEIPTNO TEXT, TRANSDATE TEXT, STOCKNO TEXT, TEK_RESNO TEXT, ASPPROCESSNO TEXT, PPROCESSORDERNO TEXT, PWORKSTATIONNO TEXT, QUANTITY TEXT, DEPOTNO TEXT, DURATION TEXT, STARTDATE TEXT, ENDDATE TEXT, GIDECEK_YERI TEXT, MTA_ADI TEXT, MTA_MIKTAR TEXT, ANA_MAMUL_NO TEXT, ANA_MAMUL_ADI TEXT , MLZ_ADI_2 TEXT, CARPAN INTEGER, BOLEN INTEGER, uSAYAC INTEGER, FOTO_NO TEXT, BKM_1SAY INTEGER, VUR_1SAY INTEGER, KALIP_DURUMU TEXT)'
			)
			.catch((err) => {
				console.error(err.message || err);
			});
		sequelize_local
			.query(
				'CREATE TABLE if not exists uretim (ID INTEGER PRIMARY KEY AUTOINCREMENT,ISEMRI_NO TEXT,SICIL TEXT,MIKTAR TEXT,TARIH_SAAT TEXT,CEVRIM_SURESI INTEGER,TEZGAH TEXT,DURUM INTEGER,KASA INTEGER,VARDIYA TEXT);'
			)
			.catch((err) => {
				console.error(err.message || err);
			});
		sequelize_local
			.query(
				'CREATE TABLE if not exists tarti (ID INTEGER PRIMARY KEY AUTOINCREMENT,ISEMRI_NO TEXT,SICIL TEXT,MIKTAR TEXT,TARIH_SAAT TEXT,CEVRIM_SURESI INTEGER,TEZGAH TEXT,DURUM INTEGER,MAX TEXT,MIN TEXT,TARTIM TEXT,UYARI TEXT);'
			)
			.catch((err) => {
				console.error(err.message || err);
			});
		sequelize_local
			.query(
				'CREATE TABLE if not exists ISKARTA ( ID INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, SEBEP_KODU TEXT, ISEMRI_NO TEXT,SICIL TEXT,TEZGAH TEXT,DURUM INTEGER,TARIH_SAAT TEXT)'
			)
			.catch((err) => {
				console.error(err.message || err);
			});
		sequelize_local
			.query(
				'CREATE TABLE if not exists YETKINLIK ( ID INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, SICIL TEXT, STOK TEXT)'
			)
			.catch((err) => {
				console.error(err.message || err);
			});
		sequelize_local
			.query('CREATE TABLE if not exists ONAY_DURUS ( DURUS_KODU TEXT )')
			.catch((err) => {
				console.error(err.message || err);
			});
		sequelize_local
			.query('CREATE TABLE if not exists ONAY_SICIL ( SICIL TEXT )')
			.catch((err) => {
				console.error(err.message || err);
			});
		sequelize_local
			.query(
				'CREATE TABLE if not exists DURUS_SEBEP ( TAN_KODU TEXT, ACIKLAMA TEXT )'
			)
			.catch((err) => {
				console.error(err.message || err);
			});
		sequelize_local
			.query(
				'CREATE TABLE if not exists PARCA_BARKODLARI ( ISEMRI_NO TEXT, STOK_NO TEXT, STOK_ADI TEXT, ICERIK TEXT, ACIKLAMA TEXT,BARKOD TEXT, SIRA_NO INTEGER DEFAULT 0, DURUM INTEGER DEFAULT 0)'
			)
			.catch((err) => {
				console.error(err.message || err);
			});

		// ADD COLUMN
		sequelize_local
			.query('ALTER TABLE WORKS ADD COLUMN DOSYA_YERI TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE WORKS ADD COLUMN MLZ_ADI_2 TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE WORKS ADD COLUMN FOTO_NO TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN ISEMRI_DEGISIM_TARIH TEXT;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN ISEMRI_KONTROL TEXT;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN ISEMRI_KONTROL_DETAIL TEXT;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN VERSION TEXT;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN TARTIM TEXT;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN ISKARTA INTEGER;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN ONAY TEXT;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN EnjKodu INTEGER DEFAULT 0;')
			.catch((err) => {});
		sequelize_local
			.query(
				'ALTER TABLE config ADD kasaEtiketiDogrudanYazdir INTEGER DEFAULT 0;'
			)
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD maksimumIsemriSayisi INTEGER DEFAULT 0;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE uretim ADD COLUMN KASA INTEGER;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN last_production TEXT;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN DURUM INTEGER DEFAULT 0;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN DURUS_BAS_ZAMAN TEXT;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN DURUS INTEGER DEFAULT 0;')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN VARDIYA TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN IP TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN MAC TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN DURUS_KODU TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN DURUS_TANIM TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE uretim ADD COLUMN prevBarkod TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE uretim ADD COLUMN STOKNO TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN TARTI_ALARM TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN IS_DURUM INTEGER DEFAULT 1')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN DURUS_ONAY INTEGER DEFAULT 0')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN BAKIM INTEGER DEFAULT 0')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN BAKIM_SICIL_1 INTEGER')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN BAKIM_SICIL_2 INTEGER')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE config ADD COLUMN KALITE_KONTROL INTEGER DEFAULT 0')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE WORKS ADD COLUMN MTA_ADI TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE WORKS ADD COLUMN MTA_MIKTAR TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE ISEMIRLERI ADD COLUMN DOSYA_YERI TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE ISEMIRLERI ADD COLUMN BKM_1SAY INTEGER')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE ISEMIRLERI ADD COLUMN VUR_1SAY INTEGER')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE ISEMIRLERI ADD COLUMN KALIP_DURUMU TEXT')
			.catch((err) => {});
		sequelize_local
			.query('ALTER TABLE ISEMIRLERI ADD COLUMN PRINT_TAG TEXT')
			.catch((err) => {});
	})
	.catch((err) => {
		console.error('LOCAL DB bağlantısı sağlanamadı... HATA:', err);
	});

sequelize_mysql
	.authenticate()
	.then(() => {
		syncTARTI();
		console.log('Connection has been established successfully.mysql');
	})
	.catch((err) => {
		console.error('Unable to connect to the database: mysql', err);
	});

// ***********************************************************
// ***********************************************************
// START
// ***********************************************************
// ***********************************************************
setTimeout(initSt, 1000 * 10);

// ***********************************************************
// ***********************************************************
// SERVICES
// ***********************************************************
// ***********************************************************
app.get('/SICIL', async function (req, res) {
	console.log('app.get => /SICIL');

	getWorker(req.query.SICILBARKOD)
		.then((data) => {
			res.json(data);
		})
		.catch((e) => {
			console.log(e);

			var exjson = {
				error: 'Sicil Bulunamadı',
			};

			res.status(404).json(exjson);
		});
});

app.get('/SICILDEGIS', async function (req, res) {
	console.log('app.get => /SICILDEGIS');

	try {
		await sequelize_local.query(
			'UPDATE config SET sicil = :SICIL , personel = :PERSONEL , kontrol_mik = 0 ,uretilen_mik = 0, iskarta = 0  ',
			{
				replacements: {
					SICIL: req.query.sicilno,
					PERSONEL: req.query.personel_adi,
				},
				type: sequelize_local.QueryTypes.UPDATE,
			}
		);

		await sequelize_local.query('delete from DURUS where transfer = 1', {
			type: sequelize_local.QueryTypes.DELETE,
		});
	} catch (err) {
		console.error(err.message || err);
	}

	res.json({
		SICIL: 'OK',
	});
});

app.post('/durusOnay', async function (req, res) {
	console.log('app.post => /durusOnay', req.body.params);

	try {
		let onay = await checkOnaySicil(req.body.params.SICIL);
		if (onay.length > 0) {
			let config = await getConfig();

			if (config.DURUS_ONAY == 1) {
				await sequelize_local.query(
					'UPDATE config SET DURUS_ONAY = 2, BAKIM = 1, BAKIM_SICIL_1 = :SICIL;',
					{
						type: sequelize_local.QueryTypes.UPDATE,
						replacements: {
							SICIL: req.body.params.SICIL,
						},
					}
				);
			} else if (config.DURUS_ONAY == 2) {
				await sequelize_local.query(
					'UPDATE config SET DURUS_ONAY = 0, BAKIM = 0, BAKIM_SICIL_2 = :SICIL;',
					{
						type: sequelize_local.QueryTypes.UPDATE,
						replacements: {
							SICIL: req.body.params.SICIL,
						},
					}
				);
			}
		} else {
			io.sockets.emit('msg', {
				status: 'error',
				msg: 'Yetkisiz Personel Tekrar Deneyiniz...',
			});
		}
	} catch (exp) {
		console.error(exp);
	}

	configUpdate();

	res.json({
		OK: 'OK',
	});
});

app.get('/GETISEMRI', async function (req, res) {
	console.log('app.get => /GETISEMRI');

	try {
		let config = await getConfig();
		let ISEMIRLERI = await getWorks(req.query.ISEMRI);

		if (
			config['maksimumIsemriSayisi'] &&
			ISEMIRLERI.length > config['maksimumIsemriSayisi']
		) {
			throw `Bu makinede en fazla ${config['maksimumIsemriSayisi']} işemri ile çalışabilirsiniz!`;
		}

		let sicil = req.query.SICIL == '' ? config.sicil : req.query.SICIL;

		if (!sicil) {
			throw 'Personel kartınızı okutunuz!';
		}

		let personel = await getWorker(sicil);

		if (req.query.SICIL != '') {
			sicilDegis(personel);
		}

		await sequelize_local.query('DELETE FROM WORKS; ', {
			type: sequelize_local.QueryTypes.DELETE,
		});

		await isEmriKontrol(ISEMIRLERI);

		let ISEMRI_NOLARI = '';
		let ISEMRI_TANIMLARI = '';

		await async
			.each(ISEMIRLERI, async function (ISEMRI) {
				ISEMRI_NOLARI += ISEMRI['ISEMRI_NO'] + ',';
				ISEMRI_TANIMLARI += ISEMRI['MLZ_ADI'] + ',';

				sendPlcSTOK(ISEMRI);
				await insertWorks(ISEMRI);
			})
			.catch((err) => {
				console.log('Yeni İş Emrileri Kayıt Edilirken Sorun Oluştu.');
				console.log(err);
			});

		await insertBarkodList();

		let tempWorks = await getWorkingWorks();

		res.json(tempWorks);

		await sequelize_local.query(
			'UPDATE config SET  IS_DURUM = 1, isemri = :ISEMRI , cinsi = :CINSI, ISKARTA = 0, uretilen_mik = 0',
			{
				replacements: {
					ISEMRI: ISEMRI_NOLARI,
					CINSI: ISEMRI_TANIMLARI,
				},
				type: sequelize_local.QueryTypes.UPDATE,
			}
		);

		configUpdate();

		printerReset();

		console.log('Yeni İş Emrileri Kayıt Edildi.');
	} catch (err) {
		console.log(err);

		io.sockets.emit(
			'263FL_RENK_BARKODU',
			JSON.stringify({
				status: 'ERROR',
				message: err.message || err,
			})
		);

		setTimeout(() => {
			res.json();
		}, 3000);
	}
});

app.get('/DURUSGETIR', async function (req, res) {
	console.log('app.get => /DURUSGETIR');

	let durussebep = await getDurusSebep();

	if (durussebep.length > 0) {
		res.json(durussebep);
	} else {
		var exjson = {
			error: 'DURUS BULUNAMADI',
		};
		res.status(404).json(exjson);
	}
});

app.get('/MAK_KOD_C/:mak_kod', async function (req, res) {
	console.log('app.get => /MAK_KOD_C/:mak_kod');

	try {
		let results = await axios
			.post(ServerURL + '/GetMachine', {
				MAK_KOD: req.params.mak_kod,
			})
			.catch((err) => {
				throw axiosError(err);
			});

		if (results.data.length == 0) {
			throw 'Makine Bulunamadı';
		}

		await sequelize_local.query('DELETE FROM ISEMIRLERI');
		await sequelize_local.query('DELETE FROM ISKARTA');
		await sequelize_local.query('DELETE FROM DURUS');
		await sequelize_local.query('DELETE FROM tarti');
		await sequelize_local.query('DELETE FROM uretim');
		await sequelize_local.query('DELETE FROM YETKINLIK');
		await sequelize_local.query('DELETE FROM WORKS');
		await sequelize_local.query('DELETE FROM DURUS_SEBEP');
		await sequelize_local.query('DELETE FROM ISKARTA_SEBEP');
		await sequelize_local.query(
			'UPDATE config SET mak_kod = :MAK_KOD , mak_adi = :MAK_ADI, isemri = NULL, personel = NULL, uretilen_mik = 0, iskarta = 0, isemri_mik = 0, cevrim_suresi = 0, isemri_durum = NULL, cinsi = NULL, sicil = NULL, kontrol = 0, kontrol_mik = 0',
			{
				replacements: {
					MAK_KOD: req.params.mak_kod,
					MAK_ADI: results.data[0].ADI,
				},
				type: sequelize_local.QueryTypes.UPDATE,
			}
		);

		ISEMRI_CEK();
		ISKARTA_UPDATE();
		DURUS_SEBEP_CEK();
		DURUS_INFO();

		let config = await getConfig();
		res.json(config);
	} catch (err) {
		console.error(err);
		res.status(400).json(err);
	}
});

app.get('/KALITE_KONTROL/:KALITE_KONTROL', async function (req, res) {
	console.log('app.get => /KALITE_KONTROL/:KALITE_KONTROL');

	console.log(req.params);

	if (!(req.params.KALITE_KONTROL == 0 && req.params.KALITE_KONTROL == 1)) {
		res.status(400).json('DURUM 0 VEYA 1 OLMALIDIR');
		return;
	}

	sequelize_local
		.query('UPDATE config SET KALITE_KONTROL :KALITE_KONTROL', {
			replacements: {
				KALITE_KONTROL: req.params.KALITE_KONTROL,
			},
			type: sequelize_local.QueryTypes.UPDATE,
		})
		.then(async () => {
			let config = await getConfig();
			res.json(config);
		})
		.catch(() => {
			res.status(400).json('İşlem sırasında hata ile karşılaşıldı.');
		});
});

app.get('/ISKARTAKAYDET', async function (req, res) {
	console.log('app.get => /ISKARTAKAYDET');
	try {
		let config = await getConfig();

		if (config.DURUS_ONAY != 0) {
			throw 'Makine duruşta olduğu durumda etiket alınamaz!';
		}

		let works = await getWorkingWorks();

		if (works.length == 0) {
			throw 'İşemri seçili olmadığı durumda etiket alınamaz!';
		}

		if (config.ISEMRI_KONTROL != 1) {
			throw config.ISEMRI_KONTROL_DETAIL;
		}

		await sequelize_local
			.query(
				"INSERT INTO ISKARTA (SEBEP_KODU, ISEMRI_NO,SICIL,TEZGAH,DURUM,TARIH_SAAT) VALUES (:SEBEP_KODU,:ISEMRI_NO,:SICIL,:TEZGAH,:DURUM,DATETIME('now'))",
				{
					replacements: {
						SEBEP_KODU: req.query.ISKARTA[0],
						ISEMRI_NO: req.query.ISEMRI[0],
						SICIL: config['sicil'],
						TEZGAH: config['mak_kod'],
						DURUM: 0,
					},
					type: sequelize_local.QueryTypes.INSERT,
				}
			)
			.catch((err) => {
				throw err.message;
			});

		await sequelize_local
			.query('UPDATE config SET iskarta = iskarta + 1;', {
				type: sequelize_local.QueryTypes.UPDATE,
			})
			.catch((err) => {
				throw err.message;
			});

		res.json('sencer');
	} catch (err) {
		io.sockets.emit('msg', {
			status: 'error',
			msg: err,
		});

		res.status(400).json({
			error: err,
		});
	}
});

app.get('/getconfig', async function (req, res) {
	console.log('app.get => /getconfig');

	let result = await sequelize_local
		.query('SELECT * FROM config', {
			type: sequelize_local.QueryTypes.SELECT,
		})
		.catch(function (e) {
			res.status(404).json(e);
		});

	if (result) {
		res.json(result);
	}

	configUpdate();
});

app.get('/DURUSBASLAT', async function (req, res) {
	console.log('app.get => /DURUSBASLAT');

	let config = await getConfig();

	if (config.DURUS == 0) {
		let ISEMIRLERI = await getWorkingWorks();

		await async.mapSeries(ISEMIRLERI, async function (ISEMRI) {
			await sequelize_local.query(
				"INSERT into DURUS (isemri,sicil,mak_kod,durus_tanim,durus_kodu,bas_saat,sure,state,transfer) VALUES (:ISEMRI,:SICIL,:MAK_KOD,:DURUS_TANIM,:DURUS_KOD,DATETIME('now'),0,1,0) ",
				{
					replacements: {
						SICIL: config['sicil'],
						MAK_KOD: config['mak_kod'],
						DURUS_TANIM: 'TANIMSIZ',
						DURUS_KOD: 'T',
						ISEMRI: ISEMRI['ISEMRI_NO'],
					},
					type: sequelize_local.QueryTypes.INSERT,
				}
			);
		});

		configUpdate();

		io.sockets.emit('msg', {
			status: 'info',
			msg: 'Duruş Başladı',
		});
	}

	res.json('sencer');
});

app.get('/DURUSTANIMLA', async function (req, res) {
	console.log('app.get => /DURUSTANIMLA');

	let config = await getConfig();

	if (req.query.st == 0) {
		// DURUŞ TANIMLAMA

		if (config.DURUS == 0) {
			// ÜRETİM DEVAM EDERKEN TANIMLI DURUŞ BAŞLATMA
			let ISEMIRLERI = await getWorkingWorks();

			await async.mapSeries(ISEMIRLERI, async function (ISEMRI) {
				await sequelize_local.query(
					"INSERT into DURUS (isemri,sicil,mak_kod,durus_tanim,durus_kodu,bas_saat,sure,state,transfer) VALUES (:ISEMRI,:SICIL,:MAK_KOD,:DURUS_TANIM,:DURUS_KOD,DATETIME('now'),0,1,0) ",
					{
						replacements: {
							SICIL: config['sicil'],
							MAK_KOD: config['mak_kod'],
							DURUS_TANIM: req.query.durustanim,
							DURUS_KOD: req.query.DURUS,
							ISEMRI: ISEMRI['ISEMRI_NO'],
						},
						type: sequelize_local.QueryTypes.INSERT,
					}
				);
			});

			io.sockets.emit('msg', {
				status: 'info',
				msg: 'Duruş Başlatıldı',
			});
		} else {
			// ÜRETİM DURMUŞKEN TANIMLI DURUŞ BAŞLATMA
			await sequelize_local.query(
				'UPDATE DURUS SET durus_kodu = :DURUS_KODU , durus_tanim = :DURUS_TANIM, state = 1 where bit_saat is null ',
				{
					replacements: {
						DURUS_KODU: req.query.DURUS,
						DURUS_TANIM: req.query.durustanim,
					},
					type: sequelize_local.QueryTypes.UPDATE,
				}
			);

			io.sockets.emit('msg', {
				status: 'info',
				msg: 'Duruş Tanımlandı',
			});
		}
	} else if (req.query.st == 1) {
		// LİSTEDEN SEÇİLEN DURUŞU TANIMLAMA
		await sequelize_local.query(
			'UPDATE DURUS SET durus_kodu = :DURUS_KODU , durus_tanim = :DURUS_TANIM , state = 1 where bas_saat = (select bas_saat from durus where id = :DURUS_ID)',
			{
				replacements: {
					DURUS_KODU: req.query.DURUS,
					DURUS_TANIM: req.query.durustanim,
					DURUS_ID: req.query.durusid,
				},
				type: sequelize_local.QueryTypes.UPDATE,
			}
		);

		io.sockets.emit('msg', {
			status: 'info',
			msg: 'Duruş Tanımlandı',
		});
	} else if (req.query.st == 2) {
		// DURUŞ BİTİRME
		durusBitir();

		io.sockets.emit('msg', {
			status: 'info',
			msg: 'Duruş Bitti',
		});
	}

	configUpdate();

	res.json('sencer');
});

app.get('/TANIMSIZDURUSGETIR', async function (req, res) {
	console.log('app.get => /TANIMSIZDURUSGETIR');
	try {
		let result = await sequelize_local.query(
			"SELECT id,sicil,DATETIME(bas_saat, '3 Hour') as bas_saat,DATETIME(bit_saat, '3 Hour') as bit_saat,sure FROM DURUS where durus_kodu='T' and bit_saat is not null and bit_saat > DATETIME('NOW', '-1 DAY') group by bas_saat order by id desc",
			{
				type: sequelize_local.QueryTypes.SELECT,
			}
		);

		res.json(result);
	} catch (error) {
		res.json([]);
		console.error(error.message || error);
	}
});

app.get('/TARTI', function (req, res) {
	console.log('app.get => /TARTI');
	io.sockets.emit('TARTIM', 'TARTI');
});

app.get('/TEST/:MIKTAR', async function (req, res) {
	console.log('app.get => /TEST/:MIKTAR');

	let config = await getConfig();
	config['now'] = new Date();

	async.timesSeries(req.params.MIKTAR, async (x) => {
		let time = (uretimSureSiniriSn + 1) * 1000;

		await new Promise((resolve) => setTimeout(resolve, time));

		URETIM();
	});

	res.status(200).json(config);
});

// ***********************************************************
// ***********************************************************
// FUNTIONS
// ***********************************************************
// ***********************************************************

async function initSt() {
	console.log('calling function => initSt');
	try {
		let xConfig = await getConfig();

		let machineConfig = await sequelize_mysql.query(
			'SELECT * FROM makineler WHERE MAK_KODU like :MAK_KODU ',
			{
				type: sequelize_mysql.QueryTypes.SELECT,
				replacements: {
					MAK_KODU: xConfig.mak_kod,
				},
			}
		);

		if (machineConfig.length == 0) {
			throw `ÜVT (${lokasyon}) sunucuda makine bulunamadı!`;
		}

		console.log(machineConfig);

		machineConfig = machineConfig[0];

		await sequelize_local.query(
			"UPDATE config SET EnjKodu = :EnjKodu, KALITE_KONTROL = :KALITE_KONTROL, kasaEtiketiDogrudanYazdir = :kasaEtiketiDogrudanYazdir, maksimumIsemriSayisi = :maksimumIsemriSayisi, VERSION = :VERSION, print = 1, ISEMRI_KONTROL = 1, ISEMRI_KONTROL_DETAIL = 'İşemri kontrolü devre dışı...'",
			{
				type: sequelize_mysql.QueryTypes.UPDATE,
				replacements: {
					EnjKodu: machineConfig['EnjKodu'],
					KALITE_KONTROL: machineConfig['kaliteKontroluYapilsinMi'],
					kasaEtiketiDogrudanYazdir: machineConfig['kasaEtiketiDogrudanYazdir'],
					maksimumIsemriSayisi: machineConfig['maksimumIsemriSayisi'] || 4,
					VERSION: VERSION,
				},
			}
		);

		xConfig = await getConfig();

		ENJ = xConfig['EnjKodu'];
		kaliteKontroluYapilsinMi = xConfig['KALITE_KONTROL'];
		kasaEtiketiDogrudanYazdir = xConfig['kasaEtiketiDogrudanYazdir'];

		if (ENJ == '0' || ENJ == '1' || ENJ == '3' || ENJ == '4') {
			ISKARTA_UPDATE();
			DURUS_SEBEP_CEK();
			ISEMRI_CEK();
			DURUS_INFO();
			startIntervals();

			if (ENJ == '0') {
				buttonUretim();
			} else if (ENJ == '1') {
				ftpUretim();
			} else if (ENJ == '3') {
				plc_uretim();
			} else if (ENJ == '4') {
				barkod_uretim();
			}
		}

		console.log(`
    *********************************************************
    ***** UYGULAMA VERSİYONU : ${VERSION}
    ***** LOKASYON : ${lokasyon}
    ***** MAKİNE KODU : ${xConfig.mak_kod}
    ***** ENJ KODU : ${ENJ}
    ***** KALİTE KONTROLÜ YAPILSIN MI? : ${kaliteKontroluYapilsinMi}
    ***** KASA ETİKETİ DOĞRUDAN YAZICIYA MI GÖNDERİLSİN? : ${kasaEtiketiDogrudanYazdir}
    *********************************************************
    `);
	} catch (err) {
		console.error(err.message || err);
	}
}

async function getConfig() {
	console.log('calling function => getConfig');

	return sequelize_local
		.query('SELECT * FROM config', {
			type: sequelize_local.QueryTypes.SELECT,
		})
		.then((data) => {
			return data[0];
		})
		.catch((err) => {
			console.error('getConfig - hata ile karşılaşıldı! HATA:', err);
			return 0;
		});
}

async function getWorkingWorks() {
	console.log('calling function => getWorkingWorks');

	return sequelize_local
		.query('SELECT * FROM WORKS', {
			type: sequelize_local.QueryTypes.SELECT,
		})
		.then((data) => {
			return data;
		})
		.catch((err) => {
			console.error('getWorkingWorks - hata ile karşılaşıldı! HATA:', err);
			return [];
		});
}

async function getIskartaSebep() {
	console.log('calling function => getIskartaSebep');

	return sequelize_local
		.query('SELECT * FROM ISKARTA_SEBEP', {
			type: sequelize_local.QueryTypes.SELECT,
		})
		.then((data) => {
			return data;
		})
		.catch((err) => {
			console.error('getIskartaSebep - hata ile karşılaşıldı! HATA:', err);
			return 0;
		});
}

async function getDurusSebep() {
	console.log('calling function => getDurusSebep');

	return sequelize_local
		.query('SELECT * FROM DURUS_SEBEP', {
			type: sequelize_local.QueryTypes.SELECT,
		})
		.then((data) => {
			return data;
		})
		.catch((err) => {
			console.error('getDurusSebep - hata ile karşılaşıldı! HATA:', err);
			return 0;
		});
}

async function printerReset() {
	console.log('calling function => printerReset');

	// PRINTER RESET
	exec('cupsenable PRINTER');
	exec('sudo find . -name "*.prn" -exec rm {} +');
	exec('cancel -a PRINTER');

	exec('cupsenable PRINTER-SOL');
	exec('cancel -a PRINTER-SOL');

	exec('cupsenable PRINTER-SAG');
	exec('cancel -a PRINTER-SAG');

	exec('cupsenable PRINTER-BIG');
	exec('cancel -a PRINTER-BIG');

	// KASA RESET
	exec('cupsenable KASA');
	exec('sudo find . -name "kasa*.pdf" -exec rm {} +');
	exec('cancel -a KASA');

	// DISABLE FINDING NETWORK PRINTERS...
	exec('sudo systemctl disable cups-browsed');
	exec('sudo systemctl stop cups-browsed');

	// DELETE PRINTERS EXCEPT KASA, PRINTER, PRINTER-SOL, PRINTER-SAG
	exec(
		"lpstat -p | awk '{print $2}' | while read printer; do if [ $printer != 'PRINTER' ] && [ $printer != 'KASA' ] && [ $printer != 'PRINTER-SOL' ] && [ $printer != 'PRINTER-SAG' ] && [ $printer != 'PRINTER-BIG' ]; then echo 'Deleting Printer:' $printer; lpadmin -x $printer; fi; done"
	);
}

function useRelay(led, value) {
	console.log('calling function => useRelay');
	console.log('value:', value);
	if (value) {
		console.log('led on');
		led.writeSync(1);
	} else {
		console.log('led off');
		led.writeSync(0);
	}
}

function vardiyaBul() {
	console.log('calling function => vardiyaBul');

	let currentTime = moment();
	let extra = moment().format('YYYY-MM-DD') + ' ';

	if (
		moment(currentTime).isBetween(
			moment(extra + '00:00'),
			moment(extra + '08:00')
		)
	)
		return 'V1';
	else if (
		moment(currentTime).isBetween(
			moment(extra + '08:00'),
			moment(extra + '16:00')
		)
	)
		return 'V2';
	else if (
		moment(currentTime).isBetween(
			moment(extra + '16:00'),
			moment(extra + '24:00')
		)
	)
		return 'V3';
}

async function changeWork(ISEMRI = []) {
	console.log('calling function => changeWork');

	try {
		printerReset();

		let ISEMIRLERI = await getWorks(ISEMRI);

		await sequelize_local.query('DELETE FROM WORKS; ', {
			type: sequelize_local.QueryTypes.DELETE,
		});

		await async.each(ISEMIRLERI, async function (ISEMRI) {
			await insertWorks(ISEMRI);
		});

		configUpdate();

		sendPlcSTOK(ISEMIRLERI[0]);

		console.log('Yeni İş Emrileri Kayıt Edildi.');
		return 'OK';
	} catch (err) {
		console.log('Yeni İş Emrileri Kayıt Edilirken Sorun Oluştu.');
		console.log(err.message || err);

		return 0;
	}
}

async function yetkinlikKaydet(yetkinlikler) {
	console.log('calling function => yetkinlikKaydet');

	sequelize_local.query('DELETE FROM YETKINLIK;').then(() => {
		for (let yetkinlik of yetkinlikler) {
			sequelize_local.query(
				'INSERT INTO YETKINLIK (SICIL,STOK) VALUES (:SICIL,:STOK);',
				{
					replacements: {
						SICIL: null,
						STOK: yetkinlik,
					},
					type: sequelize_local.QueryTypes.INSERT,
				}
			);
		}
	});
}

async function sicilDegis(personel) {
	console.log('calling function => sicilDegis');

	let config = await getConfig();

	if (config.KALITE_KONTROL) {
		const yetkinlikler = personel.YETKINLIK.filter((x) => x.onayMi == true).map(
			function (data) {
				return data.parcaNo;
			}
		);

		yetkinlikKaydet(yetkinlikler);
	}

	await sequelize_local.query(
		'UPDATE config SET sicil = :SICIL , personel = :PERSONEL   ',
		{
			replacements: {
				SICIL: personel.SICIL.SICIL,
				PERSONEL: personel.SICIL.ADI_SOYADI,
			},
			type: sequelize_local.QueryTypes.UPDATE,
		}
	);

	await sequelize_local.query('delete from DURUS where transfer = 1', {
		type: sequelize_local.QueryTypes.DELETE,
	});
}

async function sicilCikis() {
	console.log('calling function => sicilCikis');

	try {
		await sequelize_local.query(
			'UPDATE config SET sicil = :SICIL , personel = :PERSONEL , kontrol_mik = 0 ,uretilen_mik = 0, iskarta = 0  ',
			{
				replacements: {
					SICIL: 'BOS',
					PERSONEL: 'Personel Girişi Yapılmadı!',
				},
				type: sequelize_local.QueryTypes.UPDATE,
			}
		);

		await sequelize_local.query('delete from DURUS where transfer = 1', {
			type: sequelize_local.QueryTypes.DELETE,
		});
	} catch (err) {
		console.error(err.message || err);
	}
}

async function plc_connect(ip, rack, slot) {
	console.log('calling function => plc_connect');

	let isPlcConnecting = 0;

	async function connect() {
		if (!s7client.Connected() && isPlcConnecting == 0) {
			isPlcConnecting = 1;

			console.log('PLC connecting...');
			io.sockets.emit('msg', {
				status: 'info',
				msg: 'PLC bağlantısı deneniyor...',
			});

			await s7client.ConnectTo(ip, rack, slot, function (err) {
				isPlcConnecting = 0;

				if (err) {
					console.error(s7client.ErrorText(err));
					io.sockets.emit('msg', {
						status: 'error',
						msg: 'PLC bağlantısı yapılamadı',
					});
				} else {
					console.log('PLC Connected !');
					io.sockets.emit('msg', {
						status: 'info',
						msg: 'PLC bağlantısı başarılı',
					});
				}
			});
		}
	}

	await connect();

	setInterval(connect, 2000);
}

async function setDurusDurum() {
	console.log('calling function => setDurusDurum');

	let results = await sequelize_local.query(
		'SELECT * FROM DURUS ORDER BY id desc limit 1',
		{
			type: sequelize_local.QueryTypes.SELECT,
		}
	);

	let result = results[0];

	if (result && !result['bit_saat']) {
		let onay = await checkOnay(result['durus_kodu']);
		let config = await getConfig();

		await sequelize_local.query(
			'UPDATE config SET DURUS = 1, DURUS_BAS_ZAMAN = :DURUS_BAS_ZAMAN, DURUS_TANIM=:DURUS_TANIM, DURUS_KODU =:DURUS_KODU, DURUS_ONAY = :DURUS_ONAY',
			{
				type: sequelize_local.QueryTypes.UPDATE,
				replacements: {
					DURUS_TANIM: result.durus_tanim,
					DURUS_KODU: result.durus_kodu,
					DURUS_ONAY: config.DURUS_ONAY == 0 && onay.length > 0 ? 1 : 0,
					DURUS_BAS_ZAMAN: result['bas_saat'],
				},
			}
		);
	} else {
		await sequelize_local.query(
			"UPDATE config SET DURUS = 0, DURUS_BAS_ZAMAN = '', DURUS_TANIM='', DURUS_KODU ='', DURUS_ONAY = 0, BAKIM_SICIL_1 = 0,BAKIM_SICIL_2=0, BAKIM = 0;",
			{
				type: sequelize_local.QueryTypes.UPDATE,
			}
		);
	}
}

async function durusBitir() {
	console.log('calling function => durusBitir');

	await sequelize_local
		.query(
			"UPDATE DURUS SET sure = strftime('%s','now') - strftime('%s',bas_saat), bit_saat =  DATETIME('now'), state = 1 where bit_saat is null;",
			{
				type: sequelize_local.QueryTypes.UPDATE,
			}
		)
		.catch((err) => {
			console.error(err.message || err);
		});
}

async function buttonUretim() {
	let xConfig = await getConfig();

	if (xConfig.mak_kod == '01-106') {
		let last_button1 = 0;
		let last_button2 = 0;
		let aktifButton = 'button1';

		setInterval(async function () {
			let ISEMIRLERI = await getWorkingWorks();
			if (ISEMIRLERI[0] && ISEMIRLERI[0].STOKNO == 'ET76 A018W12 A.1') {
				aktifButton = 'button2';
			} else {
				aktifButton = 'button1';
			}
		}, 10000);

		button.watch(
			_.throttle(async function (err, value) {
				console.log('button1', value, aktifButton);

				if (value != last_button1) {
					last_button1 = value;
					if (value == 1 && aktifButton == 'button1') {
						URETIM();
					}
				}
			}, 800)
		);

		button2.watch(
			_.throttle(async function (err, value) {
				console.log('button2', value, aktifButton);

				if (value != last_button2) {
					last_button2 = value;
					if (value == 1 && aktifButton == 'button2') {
						URETIM();
					}
				}
			}, 800)
		);
	} else {
		let last_button1 = 0;
		let last_button2 = 0;

		button.watch(
			_.throttle(async function (err, value) {
				console.log('button1', value);
				if (value != last_button1) {
					last_button1 = value;
					if (value == 1) {
						URETIM();
					}
				}
			}, 200)
		);

		button2.watch(
			_.throttle(async function (err, value) {
				console.log('button2', value);
				if (value != last_button2) {
					last_button2 = value;
					if (value == 1) {
						// URETIM();
					}
				}
			}, 200)
		);
	}
}

async function ftpUretim() {
	try {
		fs.writeFileSync(
			'/home/pi/ftp/SESS0001.REQ',
			'00000001 EXECUTE "ReportCyclicShot2.job";',
			'utf-8'
		);

		fs.watch('/home/pi/ftp', async function (event, filename) {
			if ((filename = 'ReportCyclicShot2.dat' && event == 'change')) {
				fs.readFile(
					'/home/pi/ftp/ReportCyclicShot2.dat',
					'utf8',
					function (err, data) {
						if (err) {
							throw err;
						}

						if (data.length > 0) {
							data
								.toString()
								.split(os.EOL)
								.forEach(async function (line) {
									if (line.indexOf('DATE') < 0) {
										let config = await getConfig();

										if (line.length > 10 && config.DURUS_ONAY == 0) {
											URETIM();
										}

										fs.writeFileSync(
											'/home/pi/ftp/ReportCyclicShot2.dat',
											'',
											'utf-8'
										);
									}
								});
						}
					}
				);
			}
		});
	} catch (e) {
		console.log(e);
	}
}

async function barkod_uretim() {
	console.log('calling function => barkod_uretim');

	await portConnection();

	port.on('data', async function (buf) {
		try {
			let data = buf.toString('ascii');
			console.log(data);

			let barcodeRead = data
				.replace('\r\n', '$')
				.replace('\r\n', '$')
				.replace('\r\n', '$')
				.replace('\r\n', '$')
				.replace('\r\n', '$')
				.replace('\r\n', '$')
				.replace('\r\n', '$');

			let barkodDurum = await barkodCheck(barcodeRead);

			if (barkodDurum == true) throw `Bu Barkod Daha Önce Okutulmuş`;

			const [uResults, uMetadata] = await sequelize_local.query(
				'UPDATE PARCA_BARKODLARI SET durum = 1,BARKOD=:barcodeRead WHERE INSTR(:data, ICERIK) > 0',
				{
					type: sequelize_local.QueryTypes.UPDATE,
					replacements: {
						data: data,
						barcodeRead: barcodeRead,
					},
				}
			);

			console.log(uResults, uMetadata);

			let results = await sequelize_local.query(
				'SELECT * FROM (SELECT ISEMRI_NO,MIN(DURUM) AS DURUM  from PARCA_BARKODLARI GROUP BY ISEMRI_NO ) where DURUM = 1',
				{
					type: sequelize_local.QueryTypes.SELECT,
				}
			);

			if (results.length > 0) {
				let ISEMIRLERI = await sequelize_local.query(
					'SELECT * FROM WORKS WHERE ISEMRI_NO = :ISEMRI',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							ISEMRI: results['ISEMRI_NO'],
						},
					}
				);

				URETIM({
					ISEMIRLERI: ISEMIRLERI,
				});
			}
		} catch (error) {
			io.sockets.emit(
				'263FL_RENK_BARKODU',
				JSON.stringify({
					status: 'ERROR',
					message: error.error || error,
				})
			);
			console.error(error.message || error);
		}
	});
}

async function syncUretim() {
	console.log('calling function => syncUretim');

	try {
		let result = await sequelize_local.query(
			'SELECT * FROM uretim where durum = 0 limit 100',
			{
				type: sequelize_local.QueryTypes.SELECT,
			}
		);

		await axios
			.post(ServerURL + '/InsertPROD', {
				prod: result,
			})
			.catch((err) => {
				throw axiosError(err);
			});

		async.mapSeries(result, async function (row) {
			await sequelize_local.query(
				"UPDATE uretim SET durum = '1' where id = :ID",
				{
					replacements: {
						ID: row.ID,
					},
					type: sequelize_local.QueryTypes.UPDATE,
				}
			);
		});
	} catch (err) {
		console.log('error in function => syncUretim');
		console.error(err.message || err);
	}
}

async function syncTARTI() {
	console.log('calling function => syncTARTI');

	let result = await sequelize_local.query(
		'SELECT * FROM tarti where durum = 0',
		{
			type: sequelize_local.QueryTypes.SELECT,
		}
	);

	async.mapSeries(
		result,
		async function (row) {
			let data = await sequelize_mysql.query(
				'INSERT INTO tartim (TARIH_SAAT,TEZGAH,SICIL,MIKTAR,CEVRIM_SURESI,ISEMRI_NO,MAX,MIN,GR,DURUM) VALUES (:TARIH_SAAT,:TEZGAH,:SICIL,:MIKTAR,:CEVRIM_SURESI,:ISEMRI_NO,:MAX,:MIN,:GR,:DURUM)',
				{
					type: sequelize_mysql.QueryTypes.INSERT,
					replacements: {
						TARIH_SAAT: row.TARIH_SAAT,
						TEZGAH: row.TEZGAH,
						SICIL: row.SICIL,
						MIKTAR: row.MIKTAR,
						CEVRIM_SURESI: row.CEVRIM_SURESI,
						ISEMRI_NO: row.ISEMRI_NO,
						MAX: row.MAX,
						MIN: row.MIN,
						GR: row.TARTIM,
						DURUM: 0,
					},
				}
			);

			await sequelize_local.query(
				"UPDATE tarti SET durum = '1' where id = :ID",
				{
					type: sequelize_local.QueryTypes.UPDATE,
					replacements: {
						ID: row.ID,
					},
				}
			);
		},
		function (err) {
			if (err) console.error(err.message);
		}
	);
}

async function syncISKARTA() {
	console.log('calling function => syncISKARTA');

	try {
		let result = await sequelize_local.query(
			'SELECT * FROM ISKARTA where durum = 0',
			{
				type: sequelize_local.QueryTypes.SELECT,
			}
		);

		await axios
			.post(ServerURL + '/InsertSCRAP', {
				SCRAPS: result,
			})
			.catch((err) => {
				throw axiosError(err);
			});

		async.mapSeries(result, async function (row) {
			await sequelize_local.query(
				"UPDATE ISKARTA SET durum = '1' where id = :ID",
				{
					replacements: {
						ID: row.ID,
					},
					type: sequelize_local.QueryTypes.UPDATE,
				}
			);
		});
	} catch (err) {
		console.log(err.message || err);
	}
}

async function syncDurus() {
	console.log('calling function => syncDurus');

	try {
		await sequelize_local
			.query(
				"DELETE FROM DURUS where strftime('%s','bas_saat','bit_saat') = 0;",
				{
					type: sequelize_local.QueryTypes.DELETE,
				}
			)
			.catch((err) => {
				console.error(err.message || err);
			});

		let result = await sequelize_local.query(
			'SELECT * FROM DURUS where state < 5 and bit_saat is not null and sure > 0',
			{
				type: sequelize_local.QueryTypes.SELECT,
			}
		);

		await async.mapSeries(result, async function (row) {
			if (row.transfer == 0) {
				await axios
					.post(ServerURL + '/insertDurus', {
						DURUS: row,
					})
					.catch((err) => {
						throw axiosError(err);
					});

				await sequelize_local.query(
					"UPDATE DURUS SET transfer = '1', state = '5' where id = :ID",
					{
						replacements: {
							ID: row.id,
						},
						type: sequelize_local.QueryTypes.UPDATE,
					}
				);
			} else if (row.transfer == 1) {
				await axios
					.post(ServerURL + '/updateDurus', {
						DURUS: row,
					})
					.catch((err) => {
						throw axiosError(err);
					});

				sequelize_local.query(
					"UPDATE DURUS SET transfer = '1', state= '5' where id = :ID",
					{
						replacements: {
							ID: row.id,
						},
						type: sequelize_local.QueryTypes.UPDATE,
					}
				);
			}
		});
	} catch (err) {
		console.log(err.message || err);
	}
}

async function machine() {
	console.log('calling function => machine');

	let config = await getConfig();

	configUpdate();

	sequelize_mysql.query(
		'UPDATE makineler SET MAK_ADI = :MAK_ADI, ISEMRI = :ISEMRI, CINSI = :CINSI, CEVRIM_SURESI = :CEVRIM_SURESI, CALISAN_SICIL = :CALISAN_SICIL, MAC = :MAC,IP = :IP,VERSION = :VERSION,LAST_SEEN = NOW(), DURUM = :DURUM WHERE MAK_KODU = :MAK_KODU',
		{
			replacements: {
				MAK_ADI: config['mak_adi'] || null,
				ISEMRI: config['isemri'] || null,
				CINSI: config['cinsi'] || null,
				CEVRIM_SURESI: 0,
				CALISAN_SICIL: config['sicil'] || null,
				MAC: config['MAC'] || null,
				IP: config['IP'] || null,
				MAK_KODU: config['mak_kod'] || null,
				VERSION: config['VERSION'] || null,
				DURUM: config['DURUS'] == 0 ? 1 : 2,
			},
			type: sequelize_mysql.QueryTypes.UPDATE,
		}
	);
}

function print_uretim(
	isemri,
	CARPAN,
	mak_kod,
	sicil,
	parcakodu,
	sayac,
	PRINT_TAG,
	barkod = '',
	FOTO_NO = '',
	MLZ_ADI_2 = '',
	agirlik = ''
) {
	if (
		(mak_kod == '01-001' || mak_kod == '01-007' || mak_kod == '01-043') &&
		parcakodu == '07357343700E'
	) {
		CARPAN = 1;
	}

	if (CARPAN > 1) {
		let time = 0;
		for (let i = 1; i < CARPAN; i++) {
			time = time + 1000;
			setTimeout(function () {
				print_uretim(
					isemri,
					1,
					mak_kod,
					sicil,
					parcakodu,
					sayac,
					PRINT_TAG,
					barkod,
					FOTO_NO,
					MLZ_ADI_2,
					agirlik
				);
			}, time);
		}
	}

	let stream = fs.createWriteStream('barcode' + isemri + '.prn');

	let datetime = moment().unix();
	let datetime_print = moment().format('DD.MM.YYYY HH:mm');
	let datetime_print_ototrim = moment().format('DDMMYYYYHHmmss');
	stream
		.once('open', function () {
			if (mak_kod == 'MNT-APT-030') {
				stream.write(
					`CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR2,2~SD15^JUS^LRN^CI0^XZ\n^XA\n^MMT\n^PW200\n^LL0144\n^LS0\n^FT80,120^BQN,2,3\n^FH\\^FDLA,${datetime}^FS\n^FT80,130^A0N,17,17^FH\^FDTEST OK^FS\n`
				);

				stream.write('^PQ1,0,1,Y^XZ\n');
			} else if (mak_kod == '04-129' || mak_kod == '04-197') {
				stream.write(
					`CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR2,2~SD15^JUS^LRN^CI0^XZ\n^XA\n^MMT\n^PW240\n^LL0144\n^LS0\n^FT124,135^BQN,2,3\n^FH\\^FDLA,${isemri}\\0D\\0A${parcakodu}\\0D\\0A${datetime}\\0D\\0A${sayac}\\0D\\0A${sicil}\\0D\\0A${mak_kod}\\0D\\0A${agirlik}^FS\n^FT40,142^A0N,17,17^FH\^FD${parcakodu}^FS\n^FT109,122^A0B,28,28^FH^FDa-plas^FS\n`
				);

				if (PRINT_TAG && PRINT_TAG.length > 0) {
					stream.write(`^FT90,107^AHB,64,40^FH\^FD${PRINT_TAG}^FS\n`);
				}

				stream.write('^PQ1,0,1,Y^XZ\n');
			} else if (mak_kod == 'MNT-APT-003') {
				stream.write(
					`CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR2,2~SD15^JUS^LRN^CI0^XZ\n^XA\n^MMT\n^PW160\n^LL0080\n^LS0\n^FT47,110^BQN,2,2\n^FH\\^FDLA,${isemri}\\0D\\0A${parcakodu}\\0D\\0A${datetime}\\0D\\0A${sayac}\\0D\\0A${sicil}\\0D\\0A${mak_kod}^FS\n^PQ1,0,1,Y^XZ\n`
				);
			} else if (
				(mak_kod == '01-001' || mak_kod == '01-007' || mak_kod == '01-043') &&
				parcakodu == '07357343700E'
			) {
				stream.write(
					`CT~~CD,~CC^~CT~^XA~TA000~JSN^LT0^MNW^MTT^PON^PMN^LH0,0^JMA^PR2,2~SD22^JUS^LRN^CI0^XZ^XA^MMT^PW380^LL0236^LS0^BY46,48^FT125,85^BXN,3,200,0,0,1,~^FH\\^FD${isemri}\\0D\\0A${parcakodu}\\0D\\0A${datetime}^FS^FT157,231^A0B,16,16^FH\\^FD${parcakodu}^FS^BY46,48^FT215,85^BXN,3,200,0,0,1,~^FH\\^FD${isemri}\\0D\\0A${parcakodu}\\0D\\0A${
						Number(datetime) + 1
					}^FS^FT257,231^A0B,16,16^FH\\^FD${parcakodu}^FS^PQ1,0,1,Y^XZ`
				);
			} else if (mak_kod == 'MON-356-0001.1' || mak_kod == 'MON-356-0001.2') {
				stream.write(
					`CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR2,2~SD15^JUS^LRN^CI0^XZ\n^XA\n^MMT\n^PW240\n^LL0144\n^LS0\n^FT124,135^BQN,2,3\n^FH\\^FDLA,${isemri}\\0D\\0A${parcakodu}\\0D\\0A${MLZ_ADI_2}\\0D\\0A${datetime}\\0D\\0A${sayac}\\0D\\0A${sicil}\\0D\\0A${mak_kod}^FS\n^FT40,142^A0N,17,17^FH^FD${parcakodu}^FS\n^FT40,25^A0N,17,17^FH^FD${MLZ_ADI_2}^FS\n`
				);

				if (PRINT_TAG && PRINT_TAG.length > 0) {
					stream.write(`^FT90,107^AHB,84,52^FH^FD${PRINT_TAG}^FS\n`);
				}

				stream.write(
					'^FT51,112^AHB,38,24^FH^FDOK^FS^FT109,122^A0B,28,28^FH^FDa-plas^FS\n^PQ1,0,1,Y^XZ\n'
				);
			} 
			else if (mak_kod == "APR-MON.105" && parcakodu == "C1_B0603104114_A"){
				stream.write(
					`CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR2,2~SD15^JUS^LRN^CI0^XZ\n^XA\n^MMT\n^PW135\n^LL0144\n^LS0\n^FT25,130^BQN,2,3\n,^FH\\^FD,0A${isemri}\\0D\\0A${parcakodu}\\0D\\0A${datetime}\\0D\\0A${sayac}\\0D\\0A${sicil}\\0D\\0A${mak_kod}\\0D^FS\n^FT19,118^A0B,11,11^FH^FDTogg Jant Armasi Round^FS\n^FT07,110^A0B,13,13^FH\^FD${parcakodu}^FS^PQ1,0,1,Y^XZ`
				  );	  
				}
				else if (mak_kod == "APR-MON.105" && parcakodu == "C1_B0603104114_B"){
					stream.write(
						`CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR2,2~SD15^JUS^LRN^CI0^XZ\n^XA\n^MMT\n^PW135\n^LL0144\n^LS0\n^FT25,130^BQN,2,3\n,^FH\\^FD,0A${isemri}\\0D\\0A${parcakodu}\\0D\\0A${datetime}\\0D\\0A${sayac}\\0D\\0A${sicil}\\0D\\0A${mak_kod}\\0D^FS\n^FT19,118^A0B,11,11^FH^FDTogg Jant Armasi Star^FS\n^FT07,110^A0B,13,13^FH\^FD${parcakodu}^FS^PQ1,0,1,Y^XZ`
					  );
				}
				else if (
				mak_kod == 'MNT-BC3-MONT+POKE' ||
				mak_kod == 'MNT-CUV-KAMERA'
			) {
				FOTO_NO = FOTO_NO.substr(FOTO_NO.length - 4);

				stream.write(
					`CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR2,2~SD15^JUS^LRN^CI0^XZ\n^XA\n^MMT\n^PW240\n^LL0144\n^LS0\n^FT124,135^BQN,2,3\n^FH\\^FDLA,${isemri}${FOTO_NO}${datetime}${sicil}${mak_kod}^FS\n^FT79,122^A0B,36,36^FH\^FD${FOTO_NO}^FS\n^FT109,122^A0B,28,28^FH^FDa-plas^FS\n^PQ1,0,1,Y^XZ\n`
				);
			} else {
				stream.write(
					`CT~~CD,~CC^~CT~\n^XA~TA000~JSN^LT0^MNW^MTD^PON^PMN^LH0,0^JMA^PR2,2~SD15^JUS^LRN^CI0^XZ\n^XA\n^MMT\n^PW240\n^LL0144\n^LS0\n^FT124,135^BQN,2,3\n`
				);

				if (FOTO_NO && FOTO_NO.length > 1) {
					const sayac_ford = 'S' + datetime_print_ototrim;
					const parcakodu_ford = 'C' + FOTO_NO;

					stream.write(
						`^FH\\^FDLA,${isemri}\\0D\\0A${parcakodu_ford}\\0D\\0A${sayac_ford}\\0D\\0A${datetime}\\0D\\0A${sicil}\\0D\\0A${mak_kod}^FS\n^FT45,142^A0N,17,17^FH\^FD${FOTO_NO}^FS\n`
					);
				} else if (barkod && barkod.length > 1) {
					stream.write(
						`^FH\\^FDLA,${isemri}\\0D\\0A${parcakodu}\\0D\\0A${datetime}\\0D\\0A${sayac}\\0D\\0A${sicil}\\0D\\0A${mak_kod}\\0D\\0A${barkod}^FS\n^FT45,142^A0N,17,17^FH\^FD${parcakodu}^FS\n`
					);
				} else {
					stream.write(
						`^FH\\^FDLA,${isemri}\\0D\\0A${parcakodu}\\0D\\0A${datetime}\\0D\\0A${sayac}\\0D\\0A${sicil}\\0D\\0A${mak_kod}^FS\n^FT45,142^A0N,17,17^FH\^FD${parcakodu}^FS\n`
					);
				}

				if (PRINT_TAG && PRINT_TAG.length > 0) {
					stream.write(`^FT90,107^AHB,64,40^FH\^FD${PRINT_TAG}^FS\n`);
				}

				if (
					mak_kod == 'EN-001-3200' ||
					mak_kod == 'MNT-APT-005' ||
					mak_kod == 'MNT-APT-006' ||
					mak_kod == 'MNT-APT-007'
				) {
					stream.write(`^FT20,130^A0B,14,14^FH\^FD${datetime_print}^FS\n`);
				}

				if (mak_kod == 'A-345') {
					stream.write(
						`^FT59,122^A0B,17,17^FH\^FD${datetime}^FS\n^FT79,122^A0B,17,17^FH\^FD${barkod}^FS\n`
					);
				}

				stream.write('^FT109,122^A0B,28,28^FH^FDa-plas^FS\n^PQ1,0,1,Y^XZ\n');
			}

			stream.end();
		})
		.on('close', function (err) {
			if (mak_kod == '02-004') {
				if (PRINT_TAG == 'L') {
					exec('cupsenable PRINTER-SOL');
					exec(`lpr -P PRINTER-SOL 'barcode${isemri}.prn'`);
				} else {
					exec('cupsenable PRINTER-SAG');
					exec(`lpr -P PRINTER-SAG 'barcode${isemri}.prn'`);
				}
			} else if(mak_kod == "01-036" && parcakodu == "C1_B0603104114_A"){
				exec("cupsenable printer");
                exec("lpr -P PRINTER 'barcode" + isemri + ".prn'");
			}
			else if(mak_kod == "01-036" && parcakodu == "C1_B0603104114_B"){
				exec("cupsenable printer");
                exec("lpr -P PRINTER 'barcode" + isemri + ".prn'");
			}
			else if (
				(mak_kod == '01-001' || mak_kod == '01-007' || mak_kod == '01-043') &&
				parcakodu == '07357343700E'
			) {
				exec('cupsenable PRINTER-BIG');
				exec("lpr -P PRINTER-BIG 'barcode" + isemri + ".prn'");
			} else {
				exec('cupsenable printer');
				exec("lpr -P PRINTER 'barcode" + isemri + ".prn'");
			}
		});
}

async function uretim_local_kayit(ISEMRI) {
	console.log('calling function => uretim_local_kayit');

	try {
		let config = await getConfig();
		let vardiya = vardiyaBul();
		const prevBarkod = await getPrevBarkod(ISEMRI['ISEMRI_NO']);

		await sequelize_local.query(
			"INSERT INTO uretim (TARIH_SAAT, SICIL,MIKTAR,TEZGAH,ISEMRI_NO,CEVRIM_SURESI,DURUM,KASA,VARDIYA,STOKNO,prevBarkod) VALUES  (DATETIME('now'), :SICIL,:MIKTAR,:TEZGAH,:ISEMRI_NO,:CEVRIM_SURESI,:DURUM,:KASA,:VARDIYA,:STOKNO,:prevBarkod)",
			{
				replacements: {
					SICIL: config.sicil,
					TEZGAH: config.mak_kod,
					ISEMRI_NO: ISEMRI['ISEMRI_NO'],
					CEVRIM_SURESI: ISEMRI['CEVIRIM'],
					MIKTAR: ISEMRI['CARPAN'] > 0 ? Number(ISEMRI['CARPAN']) : 1,
					DURUM: 0,
					KASA: 0,
					VARDIYA: vardiya,
					STOKNO: ISEMRI['STOKNO'],
					prevBarkod: prevBarkod,
				},
				type: sequelize_local.QueryTypes.INSERT,
			}
		);
	} catch (error) {
		console.error(error.message || error);
		throw error.message || error;
	}
}

async function ISKARTA_UPDATE() {
	console.log('calling function => ISKARTA_UPDATE');

	try {
		let config = await getConfig();

		let results = await axios
			.post(ServerURL + '/ScrapReasons', {
				TEZGAH: config.mak_kod,
			})
			.catch((err) => {
				throw axiosError(err);
			});

		await sequelize_local.query('DELETE FROM ISKARTA_SEBEP');

		for (let item of results.data) {
			await sequelize_local.query(
				'INSERT INTO ISKARTA_SEBEP (SEBEP_KODU,SEBEP_TANIM) VALUES (:SEBEP_KODU,:SEBEP_TANIM);',
				{
					replacements: {
						SEBEP_KODU: item.ISKARTA_KODU,
						SEBEP_TANIM: item.ACIKLAMA,
					},
					type: sequelize_local.QueryTypes.INSERT,
				}
			);
		}
	} catch (err) {
		console.error(err.message || err);
	}
}

async function DURUS_INFO() {
	console.log('calling function => DURUS_INFO');

	try {
		let results = await axios.get(ServerURL + '/GetDurusInfo').catch((err) => {
			throw axiosError(err);
		});

		let DurusOnay = results.data.DurusOnay;
		let DurusOnaySicil = results.data.DurusOnaySicil;

		await sequelize_local.query('DELETE FROM ONAY_DURUS;');
		await sequelize_local.query('DELETE FROM ONAY_SICIL;');

		for (let item of DurusOnay) {
			sequelize_local.query(
				'INSERT INTO ONAY_DURUS (DURUS_KODU) VALUES (:DURUS_KODU);',
				{
					replacements: {
						DURUS_KODU: item.DURUS_KODU,
					},
					type: sequelize_local.QueryTypes.INSERT,
				}
			);
		}

		for (let item of DurusOnaySicil) {
			sequelize_local.query('INSERT INTO ONAY_SICIL (SICIL) VALUES (:SICIL);', {
				replacements: {
					SICIL: item.SICIL,
				},
				type: sequelize_local.QueryTypes.INSERT,
			});
		}
	} catch (err) {
		console.error('error in function => DURUS_INFO');
		console.error(err.message || err);
	}
}

async function DURUS_SEBEP_CEK() {
	console.log('calling function => DURUS_SEBEP_CEK');

	try {
		let results = await axios
			.post(ServerURL + '/DownTimeReasons')
			.catch((err) => {
				throw axiosError(err);
			});

		await sequelize_local.query('DELETE FROM DURUS_SEBEP;');

		for (let item of results.data) {
			sequelize_local
				.query(
					'INSERT INTO DURUS_SEBEP (TAN_KODU,ACIKLAMA) VALUES (:DURUS_KODU,:ACIKLAMA);',
					{
						replacements: {
							DURUS_KODU: item.DURUS_KODU,
							ACIKLAMA: item.ACIKLAMA,
						},
						type: sequelize_local.QueryTypes.INSERT,
					}
				)
				.catch(function (err) {
					console.log(err.message || err);
				});
		}
	} catch (error) {
		console.error(error);
	}
}

async function ISEMRI_CEK() {
	console.log('calling function => ISEMRI_CEK');
	try {
		let config = await getConfig();

		// makineye ait işemrileri alınıyor...
		let results = await axios
			.post(ServerURL + '/testWORKS', {
				TEZGAH: config.mak_kod,
			})
			.catch((err) => {
				throw axiosError(err);
			});

		console.log('İşemri sayısı:' + results.length);

		// local.db işemirleri siliniyor...
		await sequelize_local.query('DELETE FROM ISEMIRLERI;');

		// yeni işemirleri local.db'ye yazılıyor...
		await async.mapSeries(results.data, async function (item) {
			const DURATION =
				item.DURATION < 10 ? Math.floor(item.DURATION * 60) : item.DURATION;

			await sequelize_local.query(
				'INSERT INTO ISEMIRLERI (FOTO_NO,CARPAN,BOLEN,MLZ_ADI_2,ISEMRI_NO, ISEMRI_MIK, URETILEN_MIK, BAKIYE, STOK_NO, MLZ_ADI, DOSYA_YERI, ISE_UREMIK, ISE_BAKIYE, RECEIPTNO, TRANSDATE, STOCKNO, TEK_RESNO, ASPPROCESSNO, PPROCESSORDERNO, PWORKSTATIONNO, QUANTITY, DEPOTNO, DURATION, STARTDATE, ENDDATE, GIDECEK_YERI, MTA_ADI, MTA_MIKTAR, ANA_MAMUL_NO, ANA_MAMUL_ADI, BKM_1SAY, VUR_1SAY, KALIP_DURUMU, PRINT_TAG) VALUES (:FOTO_NO,:CARPAN,:BOLEN,:MLZ_ADI_2,:ISEMRI_NO,:ISEMRI_MIK,:URETILEN_MIK,:BAKIYE,:STOK_NO,:MLZ_ADI,:DOSYA_YERI,:ISE_UREMIK,:ISE_BAKIYE,:RECEIPTNO,:TRANSDATE,:STOCKNO,:TEK_RESNO,:ASPPROCESSNO,:PPROCESSORDERNO,:PWORKSTATIONNO,:QUANTITY,:DEPOTNO,:DURATION,:STARTDATE,:ENDDATE,:GIDECEK_YERI,:MTA_ADI,:MTA_MIKTAR,:ANA_MAMUL_NO,:ANA_MAMUL_ADI ,:BKM_1SAY,:VUR_1SAY,:KALIP_DURUMU,:PRINT_TAG)',
				{
					replacements: {
						FOTO_NO: item.FOTO_NO,
						CARPAN: item.CARPAN,
						BOLEN: item.BOLEN,
						MLZ_ADI_2: item.MLZ_ADI_2,
						ISEMRI_NO: item.RECEIPTNO,
						ISEMRI_MIK: item.QUANTITY,
						URETILEN_MIK: item.ISE_UREMIK,
						ISE_UREMIK: item.ISE_UREMIK,
						BAKIYE: item.ISE_BAKIYE,
						ISE_BAKIYE: item.ISE_BAKIYE,
						STOK_NO: item.STOCKNO,
						MLZ_ADI: item.ANA_MAMUL_ADI,
						DOSYA_YERI: item.DOSYA_YERI,
						RECEIPTNO: item.RECEIPTNO,
						TRANSDATE: item.TRANSDATE,
						STOCKNO: item.STOCKNO,
						TEK_RESNO: item.TEK_RESNO,
						ASPPROCESSNO: item.ASPPROCESSNO,
						PPROCESSORDERNO: item.PPROCESSORDERNO,
						PWORKSTATIONNO: item.PWORKSTATIONNO,
						QUANTITY: item.QUANTITY,
						DEPOTNO: item.DEPOTNO,
						DURATION: DURATION,
						STARTDATE: item.STARTDATE,
						ENDDATE: item.ENDDATE,
						GIDECEK_YERI: item.GIDECEK_YERI,
						MTA_ADI: item.MTA_ADI,
						MTA_MIKTAR: item.MTA_MIKTAR,
						ANA_MAMUL_NO: item.ANA_MAMUL_NO,
						ANA_MAMUL_ADI: item.ANA_MAMUL_ADI,
						BKM_1SAY: item.BKM_1SAY || 0,
						VUR_1SAY: item.VUR_1SAY || 0,
						KALIP_DURUMU: item.KALIP_DURUMU || 'BOS',
						PRINT_TAG: item.PRINT_TAG,
					},
					type: sequelize_local.QueryTypes.INSERT,
				}
			);
		});

		//
		checkWorks();
		configUpdate();
	} catch (error) {
		error = error.message || error;
		console.error(error);
	}
}

async function kasa_bas(data) {
	try {
		console.log('calling function => kasa_bas');
		console.log('kasa_bas => Data:', data);

		let isemri = data.ISEMRI || {};

		if (!isemri.ISEMRI_NO) {
			throw 'Etiket almak istediğiniz işemrini seçiniz.';
		}

		if (!isemri.MTA_MIKTAR) {
			throw 'Kasaiçi miktar bilgisi olmadan çıktı alınamaz!';
		}

		if (kasaEtiketiKalanSureSn > 0) {
			throw `Tekrardan kasa etiketi alamabilmek ${kasaEtiketiKalanSureSn} saniye beklemeniz gerekmektedir!`;
		}

		kasaEtiketiKalanSureSn = kasaEtiketiSureSiniriSn;

		let xConfig = await getConfig();

		let ISEMRIx = await sequelize_local.query(
			'SELECT * FROM ISEMIRLERI where ISEMRI_NO= :ISEMRI_NO',
			{
				type: sequelize_local.QueryTypes.SELECT,
				replacements: {
					ISEMRI_NO: isemri.ISEMRI_NO,
				},
			}
		);

		let ISEMRI = ISEMRIx[0] || {};

		let replacements = {
			ISCI_SICIL: xConfig['sicil'],
			ISCI: xConfig['personel'],
			ISEMRI_NO: ISEMRI.ISEMRI_NO,
			PARCA_NO: ISEMRI.STOK_NO,
			MIKTAR: isemri.MTA_MIKTAR || ISEMRI.MTA_MIKTAR,
			PARCA_TANIM: ISEMRI.MLZ_ADI,
			IMALATCI_PARCA_KODU: ISEMRI.TEK_RESNO,
			TASIYICI: ISEMRI.MTA_ADI,
			IMALATCI: 'A-PLAS',
			IMALAT_YERI_KODU: '201',
			URETIM_TARIH: moment().format('DD.MM.YYYY'),
			ISEMRI_TARIHI: moment().format('DD.MM.YYYY'),
			CIKTI_ZAMANI: moment().format('DD.MM.YYYY HH:mm:ss'),
			MAKINE_KODU: xConfig['mak_kod'],
			printTime: null,
		};

		await sequelize_mysql.query(
			'INSERT INTO kasa_etiketleri (ISCI_SICIL, ISCI, ISEMRI_NO, PARCA_NO, MIKTAR, PARCA_TANIM, IMALATCI_PARCA_KODU, TASIYICI, IMALATCI, IMALAT_YERI_KODU, URETIM_TARIH, ISEMRI_TARIHI, CIKTI_ZAMANI, MAKINE_KODU, printTime) VALUES (:ISCI_SICIL, :ISCI, :ISEMRI_NO, :PARCA_NO, :MIKTAR, :PARCA_TANIM, :IMALATCI_PARCA_KODU, :TASIYICI, :IMALATCI, :IMALAT_YERI_KODU, :URETIM_TARIH, :ISEMRI_TARIHI, :CIKTI_ZAMANI, :MAKINE_KODU, :printTime)',
			{
				type: sequelize_mysql.QueryTypes.INSERT,
				replacements: replacements,
			}
		);

		io.sockets.emit('msg', {
			status: 'info',
			msg: 'Kasa etiketi başarıyla gönderildi',
		});

		if (kasaEtiketiDogrudanYazdir) {
			kasaBasService(replacements);
		}
	} catch (err) {
		console.error(err);

		io.sockets.emit(
			'263FL_RENK_BARKODU',
			JSON.stringify({
				status: 'ERROR',
				message: err.message || err,
			})
		);
	}
}

async function configUpdate() {
	console.log('calling function => configUpdate');
	await setDurusDurum();
	const status = await getConfig();
	const works = await getWorks();
	const durus = await getDurusSebep();
	const iskarta = await getIskartaSebep();
	const workingWorks = await getWorkingWorks();
	const yetkinlik = await getYetkinlik();

	io.sockets.emit(
		'configUpdate',
		JSON.stringify({
			status: status || [],
			works: works || [],
			iskarta: iskarta || [],
			durus: durus || [],
			workingworks: workingWorks || [],
			yetkinlik: yetkinlik || [],
		})
	);
}

async function getYetkinlik() {
	console.log('calling function => getYetkinlik');

	const result = await sequelize_local.query('SELECT * FROM YETKINLIK;', {
		type: sequelize_local.QueryTypes.SELECT,
	});
	return result;
}

async function insertWorks(ISEMRI) {
	console.log('calling function => insertWorks');

	return sequelize_local
		.query(
			'INSERT into WORKS (MLZ_ADI_2,FOTO_NO,DOSYA_YERI,ISEMRI_NO,ISE_MIKTAR, ISE_UREMIK, ISE_BAKIYE, MLZ_ADI, STOKNO, CEVIRIM, ISE_TARIH, CARPAN, BOLEN,PRINT_TAG,MTA_ADI,MTA_MIKTAR) VALUES (:MLZ_ADI_2,:FOTO_NO,:DOSYA_YERI,:ISEMRI_NO,:ISE_MIKTAR,:ISE_UREMIK,:ISE_BAKIYE,:MLZ_ADI,:STOKNO,:CEVIRIM,:ISE_TARIH,:CARPAN,:BOLEN,:PRINT_TAG,:MTA_ADI,:MTA_MIKTAR) ',
			{
				replacements: {
					MLZ_ADI_2: ISEMRI['MLZ_ADI_2'],
					FOTO_NO: ISEMRI['FOTO_NO'],
					ISEMRI_NO: ISEMRI['ISEMRI_NO'],
					ISE_MIKTAR: ISEMRI['ISEMRI_MIK'],
					ISE_UREMIK: ISEMRI['ISE_UREMIK'],
					ISE_BAKIYE: ISEMRI['ISE_BAKIYE'],
					MLZ_ADI: ISEMRI['MLZ_ADI'],
					STOKNO: ISEMRI['STOK_NO'],
					CEVIRIM: ISEMRI['DURATION'],
					ISE_TARIH: ISEMRI['STARTDATE'],
					CARPAN: ISEMRI['CARPAN'] > 0 ? ISEMRI['CARPAN'] : 1,
					BOLEN: ISEMRI['BOLEN'] > 0 ? ISEMRI['BOLEN'] : 1,
					PRINT_TAG: ISEMRI['PRINT_TAG'],
					DOSYA_YERI: ISEMRI['DOSYA_YERI'],
					MTA_ADI: ISEMRI['MTA_ADI'],
					MTA_MIKTAR: ISEMRI['MTA_MIKTAR'],
				},
				type: sequelize_local.QueryTypes.INSERT,
			}
		)
		.then((data) => {
			return data;
		})
		.catch((err) => {
			throw err.message;
		});
}

async function getWorks(isEmriNo = null) {
	console.log('calling function => getWorks');
	let result = [];

	if (isEmriNo) {
		result = await sequelize_local.query(
			'SELECT * FROM ISEMIRLERI WHERE ISEMRI_NO in( :ISEMRI_NO )',
			{
				replacements: {
					ISEMRI_NO: isEmriNo,
				},
				type: sequelize_local.QueryTypes.SELECT,
			}
		);
	} else {
		result = await sequelize_local.query('SELECT * FROM ISEMIRLERI', {
			type: sequelize_local.QueryTypes.SELECT,
		});
	}

	return result;
}

async function checkOnay(DURUS) {
	console.log('calling function => checkOnay');

	const result = await sequelize_local.query(
		'SELECT * FROM ONAY_DURUS WHERE DURUS_KODU in( :DURUS_KODU )',
		{
			replacements: {
				DURUS_KODU: DURUS,
			},
			type: sequelize_local.QueryTypes.SELECT,
		}
	);
	if (result.length > 0) return result;
	else return [];
}

async function checkOnaySicil(SICIL) {
	console.log('calling function => checkOnaySicil');

	const result = await sequelize_local.query(
		'SELECT * FROM ONAY_SICIL WHERE SICIL = CAST(:SICIL AS INTEGER)',
		{
			replacements: {
				SICIL: SICIL,
			},
			type: sequelize_local.QueryTypes.SELECT,
		}
	);
	if (result.length > 0) return result;
	else return [];
}

async function checkWorks() {
	console.log('calling function => checkWorks');
	try {
		let works = await getWorkingWorks();

		await async.mapSeries(works, async function (ISEMRI) {
			let working = await getWorks(ISEMRI.ISEMRI_NO);

			if (working.length == 0) {
				await sequelize_local.query(
					'DELETE FROM WORKS WHERE ISEMRI_NO = :ISEMRI_NO',
					{
						replacements: {
							ISEMRI_NO: ISEMRI.ISEMRI_NO,
						},
						type: sequelize_local.QueryTypes.DELETE,
					}
				);

				io.sockets.emit('deletedWork', {
					ISEMRI: ISEMRI,
				});
				console.log('Çalışan İş Emri Bulunamadığından Silinmiştir...');
			}
		});
	} catch (error) {
		error = error.message || error;
		console.error(error);
	}
}

function getWorker(id = '') {
	console.log('calling function => getWorker');

	return new Promise(async function (resolve, reject) {
		let config = await getConfig();

		axios
			.post(ServerURL + '/TESTGetWorker', {
				TEXT: id,
				MAK_KOD: config.mak_kod,
			})
			.then(async function (results) {
				// byPass kalite kontrolü
				if (config.KALITE_KONTROL) {
					let sicil = results.data.SICIL;

					if (results.data.ZORUNLU_EGITIM == false) {
						let data = {
							status: 'ERROR',
							message: 'Personelin ZORUNLU EĞİTİMİ tamamlanmamıştır!',
						};
						io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));

						await mailBildirimGonder(
							config.mak_kod + ' Personel Yetkinlik Hatası',
							`<p><span style="color: #ff0000;"><strong>Personel <u>ZORUNLU EĞİTİMİ</u> yoktur. Gerekli Eğitimi veriniz.</strong></span><br /><br /><br /><strong>Makine Kodu : </strong> ${
								config.mak_kod
							}  - ${config.mak_adi} <br /> <strong>Personel :&nbsp;</strong> ${
								sicil.SICIL
							} - ${sicil.ADI_SOYADI}<br /> <strong>İş Emri :&nbsp;</strong> ${
								config.isemri
							} - ${config.cinsi}<br /> ${moment().format(
								'DD.MM.YYYY HH:mm'
							)}</p>`,
							'ASAS02'
						);
					}

					if (results.data.MAKINE_EGITIM == false) {
						let data = {
							status: 'ERROR',
							message: 'Personelin ZORUNLU MAKİNE EĞİTİMİ tamamlanmamıştır!',
						};
						io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));

						await mailBildirimGonder(
							config.mak_kod + ' Personel Yetkinlik Hatası',
							`<p><span style="color: #ff0000;"><strong>Personel <u>MAKİNE EĞİTİMİ</u> yoktur. Gerekli Eğitimi veriniz.</strong></span><br /><br /><br /><strong>Makine Kodu : </strong> ${
								config.mak_kod
							}  - ${config.mak_adi} <br /> <strong>Personel :&nbsp;</strong> ${
								sicil.SICIL
							} - ${sicil.ADI_SOYADI}<br /> <strong>İş Emri :&nbsp;</strong> ${
								config.isemri
							} - ${config.cinsi}<br /> ${moment().format(
								'DD.MM.YYYY HH:mm'
							)}</p>`,
							'ASAS02'
						);
					}
				}

				resolve(results.data);
			})
			.catch(function (error) {
				let data = {
					status: 'ERROR',
					message: `Personel Bulunamadı!`,
				};
				io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));

				var exjson = {
					error: 'Sicil Bulunamadı',
				};

				reject(exjson);
			});
	});
}

async function URETIM(
	extraData = {
		ISEMIRLERI: null,
		barkod: null,
		agirlik: null,
	}
) {
	console.log('calling function => URETIM');

	if (uretimKalanSureSn > 0) {
		io.sockets.emit('msg', {
			status: 'error',
			msg: `Tekrardan üretim için ${uretimKalanSureSn} saniye beklemeniz gerekmektedir!`,
		});
		return;
	}

	let config = await getConfig();

	if (config.DURUS_ONAY > 0) {
		io.sockets.emit('msg', {
			status: 'error',
			msg: 'Makine duruşta olduğu durumda etiket alınamaz!',
		});

		return;
	}

	if (config.ISEMRI_KONTROL != 1) {
		io.sockets.emit(
			'263FL_RENK_BARKODU',
			JSON.stringify({
				status: 'ERROR',
				message: config.ISEMRI_KONTROL_DETAIL,
			})
		);

		return;
	}

	let ISEMIRLERI = extraData.ISEMIRLERI;

	if (!ISEMIRLERI) {
		ISEMIRLERI = await getWorkingWorks();
	}

	if (!ISEMIRLERI || ISEMIRLERI.length == 0) {
		io.sockets.emit('msg', {
			status: 'error',
			msg: 'İşemri seçili olmadığı durumda etiket alınamaz!',
		});

		return;
	}

	uretimKalanSureSn =
		uretimSureSiniriSn > 0
			? Math.ceil(ISEMIRLERI[0].CEVIRIM * toleransCarpani)
			: uretimSureSiniriSn;

	if (config.DURUS == 1) {
		durusBitir();
	}

	async.each(
		ISEMIRLERI,
		async function (ISEMRI) {
			await sequelize_local.query(
				'UPDATE config SET uretilen_mik = uretilen_mik + :MIKTAR;',
				{
					type: sequelize_local.QueryTypes.UPDATE,
					replacements: {
						MIKTAR: ISEMRI['CARPAN'] > 0 ? Number(ISEMRI['CARPAN']) : 1,
					},
				}
			);

			await uretim_local_kayit(ISEMRI);

			//await dogrulamaBarkodSifirla(ISEMRI['ISEMRI_NO']);

			print_uretim(
				ISEMRI['ISEMRI_NO'],
				ISEMRI['CARPAN'],
				config['mak_kod'],
				config['sicil'],
				ISEMRI['STOKNO'],
				config['uretilen_mik'],
				ISEMRI['PRINT_TAG'],
				extraData.barkod || '',
				ISEMRI['FOTO_NO'],
				ISEMRI['MLZ_ADI_2'],
				extraData.agirlik || ''
			);
		},
		function (err) {
			if (err) {
				console.log('Etiket Çıktı Sorunu Oluştu.');
				console.log(err.message || err);
			} else {
				console.log('Etiket Çıktısı Alındı.');
				io.sockets.emit('ledstatus', 'red');
				configUpdate();
			}
		}
	);
}

async function checkIP() {
	console.log('calling function => checkIP');

	let config = await getConfig();

	let IP = {};
	let allAddress = await macaddress.all();

	if (allAddress) {
		allAddress = Object.values(allAddress);

		allAddress = allAddress.filter((element) => {
			if (element.ipv4 && element.ipv4.startsWith('10.')) {
				return element;
			}
		});

		IP = allAddress[0] || {};
	}

	if (config.IP && !IP['ipv4']) {
		io.sockets.emit(
			'263FL_RENK_BARKODU',
			JSON.stringify({
				status: 'ERROR',
				message: 'İnternet Bağlantısı Kesildi',
			})
		);
	} else if (!config.IP && IP['ipv4']) {
		io.sockets.emit(
			'263FL_RENK_BARKODU',
			JSON.stringify({
				status: 'OK',
				message: 'İnternet Bağlantısı Geldi',
			})
		);
	}

	if (config.IP != IP['ipv4']) {
		sequelize_local.query('UPDATE config SET IP = :IP, MAC = :MAC ', {
			replacements: {
				IP: IP['ipv4'] || null,
				MAC: IP['mac'] || null,
			},
			type: sequelize_local.QueryTypes.UPDATE,
		});
	}
}

async function insertBarkodList() {
	console.log('calling function => insertBarkodList');

	try {
		let calisanIsemirleri = await getWorkingWorks();

		let barkodListesi = await async.mapSeries(
			calisanIsemirleri,
			async (work) => {
				let rows = await axios
					.post(ServerURL + '/getBarkodList', {
						STOCK_NO: work.STOKNO,
					})
					.catch((err) => {
						throw axiosError(err);
					});

				rows = rows.data;

				rows = rows.map((row) =>
					Object.assign({}, row, {
						ISEMRI_NO: work.ISEMRI_NO,
						STOK_NO: work.STOKNO,
						STOK_ADI: work.MLZ_ADI,
					})
				);

				return rows;
			}
		);

		barkodListesi = [].concat.apply([], barkodListesi);

		await sequelize_local.query('DELETE FROM PARCA_BARKODLARI', {
			type: sequelize_local.QueryTypes.DELETE,
		});

		await async.mapSeries(barkodListesi, async (data) => {
			await sequelize_local.query(
				'INSERT INTO PARCA_BARKODLARI (ISEMRI_NO, STOK_NO, STOK_ADI, ICERIK, ACIKLAMA, DURUM) VALUES (:ISEMRI_NO, :STOK_NO, :STOK_ADI, :ICERIK, :ACIKLAMA, :DURUM)',
				{
					replacements: {
						ISEMRI_NO: data.ISEMRI_NO,
						STOK_NO: data.STOK_NO,
						STOK_ADI: data.STOK_ADI,
						ICERIK: data.icerecekMetin,
						ACIKLAMA: data.aciklama,
						SIRA_NO: data.siraNo,
						DURUM: 0,
					},
					type: sequelize_local.QueryTypes.INSERT,
				}
			);
		});
	} catch (err) {
		console.error(err.message || err);
		throw err.message || err;
	}
}

async function sendPlcSTOK(ISEMRI) {
	console.log('calling function => sendPlcSTOK');

	const STOKNO = ISEMRI['STOK_NO'] || ISEMRI['STOKNO'];

	console.log('PLC STOK NO YAZxx : ', STOKNO);

	let xConifg = await getConfig();
	if (
		xConifg.mak_kod == 'EN-363MCA-DEF-01' ||
		xConifg.mak_kod == 'EN-363MCA-DEF-02'
	) {
		let bufx = Buffer.from(STOKNO.padEnd(50, ' '));

		s7client.DBWrite(200, 4, bufx.length, bufx, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MNT-BC3-MONT+POKE') {
		let bufx = Buffer.from(STOKNO.padEnd(50, ' '));

		s7client.DBWrite(11, 0, bufx.length, bufx, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MNT-CUV-KAMERA') {
		let bufx = Buffer.from(STOKNO.padEnd(50, ' '));

		s7client.DBWrite(200, 228, bufx.length, bufx, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (
		xConifg.mak_kod == 'APR-ENJ.92' ||
		xConifg.mak_kod == 'APR-ENJ.82' ||
		xConifg.mak_kod == 'A-345' ||
		xConifg.mak_kod == 'APR-ENJ.85' ||
		xConifg.mak_kod == 'A-318' ||
		xConifg.mak_kod == 'APR-ENJ.86' ||
		xConifg.mak_kod == 'APR-ENJ.84' ||
		xConifg.mak_kod == 'APR-ENJ.173' ||
		xConifg.mak_kod == 'A-342'
	) {
		var buf = Buffer.from(pad(STOKNO, 50), 'ascii');

		s7client.DBWrite(200, 4, buf.length, buf, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'APR-MON.027') {
		var buf = Buffer.from(pad(STOKNO, 100), 'ascii');

		s7client.DBWrite(200, 4, buf.length, buf, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MON-356-HB-ND') {
		let bufx = Buffer.from(STOKNO.padEnd(50, ' '));

		s7client.DBWrite(200, 4, bufx.length, bufx, function (err, res) {
			console.log(xConifg.mak_kod, '-*-*-*--*-*');
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MNT-APT-005') {
		s7client.DBWrite(100, 3, 1, Buffer.from([0x01]), function (err) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MNT-APT-006') {
		s7client.DBWrite(100, 4, 1, Buffer.from([0x01]), function (err) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MON-356-ND-1') {
		let bufx = Buffer.from(STOKNO.padEnd(50, ' '));

		s7client.DBWrite(200, 8, bufx.length, bufx, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MON-356-ND-2') {
		let bufx = Buffer.from(STOKNO.padEnd(50, ' '));

		s7client.DBWrite(200, 108, bufx.length, bufx, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MNT-APT-001') {
		let bufx = Buffer.from(STOKNO.padEnd(100, ' '));

		s7client.DBWrite(200, 4, bufx.length, bufx, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MB-001') {
		var buf = Buffer.from(pad(STOKNO, 50), 'ascii');

		s7client.DBWrite(9, 0, buf.length, buf, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (
		xConifg.mak_kod == 'APR-ENJ.83' ||
		xConifg.mak_kod == 'APR-MON.023' ||
		xConifg.mak_kod == 'APR-ENJ.170'
	) {
		var buf = Buffer.from(pad(STOKNO, 100), 'ascii');

		s7client.DBWrite(200, 4, buf.length, buf, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}

			console.log('sendPlcSTOK => Stok numarası yazılıyor...', STOKNO);
		});
	} else if (xConifg.mak_kod == 'MNT-APT-023') {
		s7client.DBWrite(100, 4, 1, Buffer.from([0x01]), function (err) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (xConifg.mak_kod == 'MNT-APT-024') {
		s7client.DBWrite(100, 3, 1, Buffer.from([0x01]), function (err) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
		});
	} else if (
		xConifg.mak_kod == 'MON-356-0001.1' ||
		xConifg.mak_kod == 'MON-356-0001.2'
	) {
		const DB = xConifg.mak_kod == 'MON-356-0001.1' ? 201 : 200;

		var buf = Buffer.from(pad(ISEMRI.ISEMRI_NO, 50), 'ascii');
		var tip = Buffer.from(pad(ISEMRI.MLZ_ADI_2.substr(0, 3), 3), 'ascii');
		var renk = Buffer.from(pad(ISEMRI.MLZ_ADI_2.substr(4, 3), 3), 'ascii');

		s7client.DBWrite(DB, 8, buf.length, buf, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}

			s7client.DBWrite(DB, 0, tip.length, tip, function (err, res) {
				if (err) {
					return console.error(s7client.ErrorText(err));
				}

				s7client.DBWrite(DB, 4, renk.length, renk, function (err, res) {
					if (err) {
						return console.error(s7client.ErrorText(err));
					}
				});
			});
		});
	} else if (
		xConifg.mak_kod == 'APR-MON.094' ||
		xConifg.mak_kod == 'APR-MON.093'
	) {
		const DB = xConifg.mak_kod == 'APR-MON.094' ? 326 : 226;

		let tip = '';

		if (ISEMRI.MLZ_ADI.includes('PHEV')) tip = '4';
		else if (ISEMRI.MLZ_ADI.includes('DIESEL')) tip = '3';
		else if (ISEMRI.MLZ_ADI.includes('BENZIN')) tip = '2';
		else if (ISEMRI.MLZ_ADI.includes('LKM')) tip = '1';

		let buf = Buffer.allocUnsafe(2);
		buf.writeInt16BE(tip, 0);

		var b5 = new Buffer([0x01]);

		var arr = [buf, b5];

		buf = Buffer.concat(arr);

		s7client.DBWrite(DB, 308, buf.length, buf, function (err, res) {
			if (err) {
				return console.error(s7client.ErrorText(err));
			}
			console.log('sendPlcSTOK => PLC Tip yazılıyor...', tip);
		});
	} else if (xConifg.mak_kod == 'APR-MON.105') {
		const DB = 35;

		let tip;

		if (ISEMRI.MLZ_ADI.includes('STAR')) tip = '1';
		else if (ISEMRI.MLZ_ADI.includes('ROUND')) tip = '2';
		else tip = '0';

		await writeIntToPLC(DB, 0, tip);
	}
}

async function kasaBasService(data) {
	console.log('calling function => kasaBasService');

	let results = await axios
		.post(LOCAL_KASA_BAS_SERVICE, {
			data: data.ISCI_SICIL,
		})
		.catch(function (error) {
			throw error;
		});

	return results.data;
}

async function setIsemriKontrolDurum(status, aciklama) {
	console.log('calling function => setIsemriKontrolDurum');

	sequelize_local
		.query(
			'UPDATE config SET  ISEMRI_KONTROL = :status , ISEMRI_KONTROL_DETAIL = :aciklama ',
			{
				replacements: {
					status: status,
					aciklama: aciklama,
				},
				type: sequelize_local.QueryTypes.UPDATE,
			}
		)
		.then((data) => {
			console.log(data);
		})
		.catch(function (e) {
			console.log(e);
		});

	let config = await getConfig();

	if (config.ISEMRI_KONTROL == 1 && status == 0) {
		await mailBildirimGonder(
			config.mak_kod + ' Kalite Kontrolü - Üretim Durduruldu',
			`<p><span style="color: #ff0000;"><strong>Makinedeki üretim durdurulmuştur. Lütfen Kontrol Ediniz.<br /> Durumu :&nbsp;${
				config.ISEMRI_KONTROL_DETAIL
			}</strong></span><br /><br /><br /><strong>Makine Kodu : </strong> ${
				config.mak_kod
			}  - ${config.mak_adi} <br /> <strong>Personel :&nbsp;</strong> ${
				config.sicil
			} - ${config.personel}<br /> <strong>İş Emri :&nbsp;</strong> ${
				config.isemri
			} - ${config.cinsi}<br /> ${moment().format('DD.MM.YYYY HH:mm')}</p>`,
			'ASAS02'
		);
	}
}

async function isEmriKontrol(ISEMIRLERI) {
	console.log('calling function => isEmriKontrol');

	let config = await getConfig();

	if (!config.KALITE_KONTROL) {
		return;
	}

	console.log('ISEMIRLERI için seri başlangıç kontrolü yapılıyor...');

	if (!ISEMIRLERI || ISEMIRLERI.length == 0) {
		ISEMIRLERI = await getWorkingWorks();
	}

	if (ISEMIRLERI.length == 0) {
		return;
	}

	let isemriDurumlari = await async.mapSeries(ISEMIRLERI, async (isemri) => {
		let result = await axios.post(KALITE_KONTROL_SERVICE, {
			isEmriNo: isemri.ISEMRI_NO,
			makineKodu: config.mak_kod,
		});

		return result.data;
	});

	let onaysizDurumlar = isemriDurumlari.filter((durum) => durum['onayMi'] != 1);

	if (onaysizDurumlar.length > 0) {
		setIsemriKontrolDurum(0, onaysizDurumlar[0]['aciklama']);
	} else {
		setIsemriKontrolDurum(1, isemriDurumlari[0]['aciklama']);
	}
}

function mailBildirimGonder(header, content, proje) {
	console.log('calling function => mailBildirimGonder');

	return new Promise(async function (resolve, reject) {
		axios
			.post(ServerURL + '/bildirimMail/' + proje, {
				header: header,
				content: content,
			})
			.then(function (results) {
				resolve(results.data);
			})
			.catch(function (error) {
				reject(error);
			});
	});
}

async function portConnection(dataFunction) {
	console.log('calling function => portConnection');
	try {
		let serialPort;
		let config = await getConfig();

		if (config.mak_kod == '04-129' || config.mak_kod == '04-197') {
			serialPort = new SerialPort('/dev/ttyUSB0', {
				baudRate: 9600,
				autoOpen: false,
			});
		} else {
			serialPort = new SerialPort('/dev/ttyACM0', {
				baudRate: 9600,
				autoOpen: false,
			});
		}

		const reconnectPort = () => {
			console.log('Port yeniden bağlanma birazdan başlatılıyor...');
			setTimeout(function () {
				console.log('Port yeniden bağlanmayı deniyor...');
				serialPort.open();
			}, 2000);
		};

		serialPort.on('open', () => console.log('Port başarıyla bağlandı.'));

		serialPort.on('close', function () {
			console.log('Port kapandı!');
			reconnectPort();
		});

		serialPort.on('error', function (err) {
			console.error('Port hata verdi!', err);
			reconnectPort();
		});

		port = serialPort.pipe(
			new SerialPort.parsers.Readline({
				delimiter: '$',
			})
		);

		if (dataFunction) {
			port.on('data', dataFunction);
		}

		serialPort.open();
	} catch (err) {
		console.error('ERROR occurred in portConnection function! => ', err);
		reconnectPort();
	}
}

function axiosError(error) {
	console.log('calling function => axiosError');

	let message = null;

	if (error.response) {
		if (error.response.data.name == 'SequelizeDatabaseError') {
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

function startIntervals() {
	setInterval(ISEMRI_CEK, 10 * 60 * 1000);
	setInterval(DURUS_INFO, 10 * 60 * 1000);
	setInterval(DURUS_SEBEP_CEK, 10 * 60 * 1000);
	setInterval(syncUretim, 1 * 60 * 1000);
	setInterval(syncISKARTA, 5 * 60 * 1000);
	setInterval(syncTARTI, 5 * 60 * 1000);
	setInterval(syncDurus, 5 * 60 * 1000);
	setInterval(machine, 1 * 60 * 1000);
	setInterval(isEmriKontrol, 1 * 60 * 1000);
	setInterval(checkIP, 1 * 60 * 1000);
	setInterval(configUpdate, 30 * 1000);
	setInterval(() => {
		kasaEtiketiKalanSureSn = kasaEtiketiKalanSureSn - 1;
		uretimKalanSureSn = uretimKalanSureSn - 1;
	}, 1000);
}

async function plc_uretim() {
	console.log('calling function => plc_uretim');

	let xConfig = await getConfig();

	if (
		xConfig.mak_kod == 'MNT-MASA-017' ||
		xConfig.mak_kod == 'MNT-MASA-018' ||
		xConfig.mak_kod == 'MNT-MASA-019'
	) {
		await portConnection();

		port.on('data', async function (data) {
			try {
				await sequelize_local.query('DELETE FROM WORKS; ', {
					type: sequelize_local.QueryTypes.DELETE,
				});

				const buf = data.toString('ascii');

				let result = await sequelize_local.query('SELECT * FROM ISEMIRLERI', {
					type: sequelize_local.QueryTypes.SELECT,
				});

				result = result.filter(
					(x) => x.MLZ_ADI_2 && buf.includes(x.MLZ_ADI_2)
				)[0];

				if (!result) {
					throw "'Malzeme Adı 2' ile eşleşen işemri bulunamadı!";
				}

				await changeWork([result.ISEMRI_NO]);

				URETIM();
			} catch (err) {
				console.error(err);
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: err.message || err,
					})
				);
			}
		});
	} else if (
		xConfig.mak_kod == 'BOY-UVT-SOL' ||
		xConfig.mak_kod == 'BOY-UVT-SAĞ'
	) {
		await portConnection();

		port.on('data', async function (data) {
			try {
				await sequelize_local.query('DELETE FROM WORKS; ', {
					type: sequelize_local.QueryTypes.DELETE,
				});

				const buf = data.toString('ascii');

				let result = await sequelize_local.query('SELECT * FROM ISEMIRLERI', {
					type: sequelize_local.QueryTypes.SELECT,
				});

				result = result.filter(
					(x) => x.MLZ_ADI_2 && buf.includes(x.MLZ_ADI_2)
				)[0];

				if (!result) {
					throw "'Malzeme Adı 2' ile eşleşen işemri bulunamadı!";
				}

				await changeWork([result.ISEMRI_NO]);

				URETIM();
			} catch (err) {
				console.error(err);
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: err.message || err,
					})
				);
			}
		});
	} else if (xConfig.mak_kod == 'MON-TT-KAPAK') {
		await portConnection();

		port.on('data', async function (data) {
			const buf = data.toString('ascii');
			const buf2 = buf.split('\r\n');

			let result = await sequelize_local.query('SELECT * FROM WORKS', {
				type: sequelize_local.QueryTypes.SELECT,
			});

			if (result.length > 1) {
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message:
							'Bu makinede aynı anda 1 tane işemri ile çalışabilirsiniz!',
					})
				);

				return;
			}

			if (result.length == 0) {
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: 'İşemri seçili olmadığı için işleme devam edilemiyor!',
					})
				);

				return;
			}

			result = result[0] || {};

			if (buf2[1] != result.MLZ_ADI_2) {
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: 'Seçili olan işemri ile okutulan parça eşleşmemektedir!',
					})
				);

				return;
			}

			URETIM();
		});
	} else if (xConfig.mak_kod == 'MNT-APT-030') {
		uretimSureSiniriSn = 0;
		await portConnection();

		port.on('data', async function (data) {
			let buf = data.toString('ascii');
			buf = buf.split('\r\n');
			let barkodStokNo = buf[1];
			let barkodUretimZamani = buf[2];
			let kontrolTarihi = moment().subtract(14, 'hours').unix();

			if (barkodUretimZamani > kontrolTarihi) {
				let data = {
					status: 'ERROR',
					message:
						'Çekme testi için parçanın üretim zamanı üzerinden en az 14 saat geçmesi gerekmektedir.',
				};
				console.log(data);
				io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
			} else {
				if (barkodStokNo == '735674214.1') {
					// sol parça
					if (s7client.Connected()) {
						s7client.WriteArea(
							s7client.S7AreaDB,
							200,
							230 * 8 + 2,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					}

					let data = {
						status: 'OK',
						message: `SOL Parça test için uygundur! STOK NO: ${barkodStokNo}`,
					};
					console.log(data);
					io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
				} else if (barkodStokNo == '735674212.1') {
					// sağ parça
					if (s7client.Connected()) {
						s7client.WriteArea(
							s7client.S7AreaDB,
							200,
							230 * 8 + 1,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					}

					let data = {
						status: 'OK',
						message: `SAĞ Parça test için uygundur! STOK NO: ${barkodStokNo}`,
					};
					console.log(data);
					io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
				} else {
					let data = {
						status: 'ERROR',
						message: `Parça referansı doğru değil !!! STOK NO: ${barkodStokNo}`,
					};
					console.log(data);
					io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
				}
			}
		});

		plcConfig = {
			IP: '192.168.0.10',
			rack: 0,
			slot: 0,
		};

		items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLByte,
				DBNumber: 200,
				Start: 204,
				Amount: 1,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, async function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last != temp_digital) {
							if (digital_last[7] == 1 && temp_digital[7] != digital_last[7]) {
								// SOL ETİKET
								console.log('SOL');

								let ISEMIRLERI = await sequelize_local.query(
									"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '% SX'",
									{
										type: sequelize_local.QueryTypes.SELECT,
									}
								);

								URETIM({
									ISEMIRLERI: ISEMIRLERI,
								});

								s7client.DBWrite(
									items[0].DBNumber,
									items[0].Start,
									items[0].Amount,
									Buffer.from([0x00]),
									function (err) {
										if (err) {
											return console.error(s7client.ErrorText(err));
										}
									}
								);
							}

							if (digital_last[6] == 1 && temp_digital[6] != digital_last[6]) {
								// SAĞ ETİKET
								console.log('SAĞ');

								let ISEMIRLERI = await sequelize_local.query(
									"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '% DX'",
									{
										type: sequelize_local.QueryTypes.SELECT,
									}
								);

								URETIM({
									ISEMIRLERI: ISEMIRLERI,
								});

								s7client.DBWrite(
									items[0].DBNumber,
									items[0].Start,
									items[0].Amount,
									Buffer.from([0x00]),
									function (err) {
										if (err) {
											return console.error(s7client.ErrorText(err));
										}
									}
								);
							}
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'MŞ-03') {
		uretimSureSiniriSn = 0;
		const client = new net.Socket();
		let old_istasyon_a = 1;
		let old_istasyon_b = 1;
		let old_istasyon_c = 1;

		client.connect(7777, '192.168.0.100', function () {
			console.log('Connected');
			client.write('Hello, server! Love, Client.');
		});

		client.on('data', function (data) {
			console.log('Received: ' + data);

			if (old_istasyon_a == 0 && data == 'a1') {
				old_istasyon_a = 1;
				URETIM();
			} else if (data == 'a0') {
				old_istasyon_a = 0;
			}

			if (old_istasyon_b == 0 && data == 'b1') {
				old_istasyon_b = 1;
				URETIM();
			} else if (data == 'b0') {
				old_istasyon_b = 0;
			}

			if (old_istasyon_c == 0 && data == 'c1') {
				old_istasyon_c = 1;
				URETIM();
			} else if (data == 'c0') {
				old_istasyon_c = 0;
			}
		});

		client.on('close', function () {
			console.log('Connection closed');
		});
	} else if (xConfig.mak_kod == 'A-350') {
		// HOT STAMPING - KAMERA ROBOT KONTROL BANKOSU
		let barkodx = '';
		let stokNo = '';
		await portConnection();

		port.on('data', async function (data) {
			try {
				let barkod = data.toString('ascii');
				barkod = barkod.replace('$', '');
				barkod = barkod.replace(/[\r\n]+/g, '');

				console.log('Data:', barkod);

				if (barkod == barkodx) {
					console.log('Aynı barkod okutuldu!');
					return;
				}

				// HOT STAMPING YAPILDIĞI KONTROL EDİLİYOR
				let seriUretimData = await axios
					.post(ServerURL + '/hotstamping/getProduction', {
						barkod: barkod,
					})
					.then((results) => {
						return results['data'];
					})
					.catch((err) => {
						throw axiosError(err);
					});

				if (!seriUretimData) {
					throw 'Barkod ile ilişkili üretim kaydı bulunamadı!';
				}

				// STOK NUMARASI PLC'YE YAZILACAK
				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				stokNo = workingWorks[0]['STOKNO'];

				if (!seriUretimData['starlockStokNo']) {
					throw 'Starlock işlemi yapılmamış!';
				}

				if (
					(stokNo == '735734375.ENTRY' &&
						seriUretimData['starlockStokNo'] == '735734364.28') || // MCA_ENTRY
					(stokNo == '735734364.MID' &&
						seriUretimData['starlockStokNo'] == '735734364.25') || // MCA_MID
					(stokNo == '735734364.HIGH' &&
						seriUretimData['starlockStokNo'] == '735734364.22') || // MCA_HIGH
					(stokNo == '735734385.ENTRY' &&
						seriUretimData['starlockStokNo'] == '735734385.21') || // CORSS_ENRTY
					(stokNo == '735758084.GARMIN' &&
						seriUretimData['starlockStokNo'] == '735758084.22') // CORSS_GARMIN
				) {
					const DB = 39;
					const tip = workingWorks[0].MLZ_ADI_2.split(' ');
					const TIP_IZGARA = Buffer.from(tip[0], 'ascii');
					const KORNIS = Buffer.from(tip[1], 'ascii');
					const LOGO = Buffer.from(tip[2], 'ascii');
					const HOT_STAMPING = Buffer.from(tip[3], 'ascii');

					s7client.DBWrite(
						DB,
						0,
						TIP_IZGARA.length,
						TIP_IZGARA,
						function (err, res) {
							if (err) {
								return console.error(s7client.ErrorText(err));
							}
							s7client.DBWrite(
								DB,
								4,
								KORNIS.length,
								KORNIS,
								function (err, res) {
									if (err) {
										return console.error(s7client.ErrorText(err));
									}

									s7client.DBWrite(
										DB,
										8,
										LOGO.length,
										LOGO,
										function (err, res) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}

											s7client.DBWrite(
												DB,
												12,
												HOT_STAMPING.length,
												HOT_STAMPING,
												function (err, res) {
													if (err) {
														console.error(s7client.ErrorText(err));
														return;
													}
												}
											);
										}
									);
								}
							);
						}
					);
				} else {
					throw `Seçilen işemri stok numarası (${stokNo}) ile parça stok numarası (${seriUretimData['starlockStokNo']}) uyumsuz olduğu için işleme devam edilemiyor!`;
				}

				barkodx = barkod;
			} catch (error) {
				console.log(error);
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error,
					})
				);
			}
		});

		plc_connect('192.168.0.30', 0, 0);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.DBWrite(39, 17, 1, Buffer.from([0x01]), function (err) {
					if (err) {
						console.error(s7client.ErrorText(err));
						return;
					}
				});

				let items = [
					{
						Area: s7client.S7AreaDB,
						WordLen: s7client.S7WLByte,
						DBNumber: 39,
						Start: 16,
						Amount: 1,
					},
				];

				s7client.ReadMultiVars(items, async function (err, res) {
					if (err || res[0].Result != 0) {
						console.error(s7client.ErrorText(err || res[0].Result));
						return;
					}

					let temp_digital = pad(8, digital.toString(), '0');
					let digital_last = parseInt(res[0].Data.toString('hex'), 16).toString(
						2
					);
					digital_last = pad(8, digital_last, '0');
					digital = digital_last;

					console.log('PLC SİNYALİ:', digital);

					if (digital_last[7] == 1) {
						if (digital_last != temp_digital) {
							let config = await getConfig();

							await axios
								.post(ServerURL + '/hotstamping/setProduction', {
									operasyon: 'KAMERA_KONTROL',
									barkod: barkodx,
									sicil: config.sicil,
									stokNo: stokNo,
								})
								.catch((err) => {
									throw axiosError(err);
								});

							URETIM();
						}

						s7client.DBWrite(
							items[0].DBNumber,
							items[0].Start,
							items[0].Amount,
							Buffer.from([0x00]),
							function (err) {
								if (err) {
									console.error(s7client.ErrorText(err));
									return;
								}
							}
						);
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'A-348') {
		// HOT STAMPING - STARLOCK ÇAKMA BANKOSU
		let barkodx = '';
		let stokNo = '';
		await portConnection();

		port.on('data', async function (data) {
			try {
				let barkod = data.toString('ascii');
				barkod = barkod.replace('$', '');
				barkod = barkod.replace(/[\r\n]+/g, '');
				console.log('Data:', barkod);

				// HOT STAMPING YAPILDIĞI KONTROL EDİLİYOR
				let seriUretimData = await axios
					.post(ServerURL + '/hotstamping/getProduction', {
						barkod: barkod,
					})
					.then((results) => {
						return results['data'];
					})
					.catch((err) => {
						throw axiosError(err);
					});

				if (!seriUretimData) {
					throw 'Barkod ile ilişkili üretim kaydı bulunamadı!';
				}

				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				stokNo = workingWorks[0]['STOKNO'];

				if (!seriUretimData['kornisStokNo']) {
					throw 'Parça için logo korniş montajı yapılmamış!';
				}

				if (
					(stokNo == '735734364.28' &&
						seriUretimData['kornisStokNo'] == '735734364.27') || // MCA_ENTRY
					(stokNo == '735734364.25' &&
						seriUretimData['kornisStokNo'] == '735734364.24') || // MCA_MID
					(stokNo == '735734364.22' &&
						seriUretimData['kornisStokNo'] == '735734364.21') // MCA_HIGH
				) {
					let bufx = Buffer.from('MCA');
					s7client.DBWrite(43, 0, bufx.length, bufx, function (err, res) {
						if (err) {
							console.error(s7client.ErrorText(err));
							return;
						}
					});
				} else if (
					(stokNo == '735734385.21' &&
						seriUretimData['kornisStokNo'] == '735734385.2') || // CROSS_ENRTY
					(stokNo == '735758084.22' &&
						seriUretimData['kornisStokNo'] == '735758084.21') // CROSS_GARMIN
				) {
					let bufx = Buffer.from('CRS');
					s7client.DBWrite(43, 0, bufx.length, bufx, function (err, res) {
						if (err) {
							console.error(s7client.ErrorText(err));
							return;
						}
					});
				} else {
					throw `Seçilen işemri stok numarası (${stokNo}) ile parça stok numarası (${seriUretimData['kornisStokNo']}) uyumsuz olduğu için işleme devam edilemiyor!`;
				}

				barkodx = barkod;
			} catch (error) {
				error = error.message || error;
				console.log(error);
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error,
					})
				);
			}
		});

		plc_connect('192.168.0.30', 0, 0);

		setInterval(() => {
			if (!s7client.Connected()) {
				console.error('PLC bağlantısı yapılamadı!');
				return;
			}

			s7client.DBWrite(43, 5, 1, Buffer.from([0x01]), function (err) {
				if (err) {
					console.error(s7client.ErrorText(err));
					return;
				}
			});

			let items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 43,
					Start: 4,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				if (err || res[0].Result != 0) {
					console.error(s7client.ErrorText(err || res[0].Result));
					return;
				}

				let temp_digital = pad(8, digital.toString(), '0');
				let digital_last = parseInt(res[0].Data.toString('hex'), 16).toString(
					2
				);
				digital_last = pad(8, digital_last, '0');
				digital = digital_last;

				console.log('PLC SİNYALİ:', digital);

				if (digital_last[7] == 1) {
					if (digital_last[7] != temp_digital[7]) {
						let config = await getConfig();

						await axios
							.post(ServerURL + '/hotstamping/setProduction', {
								operasyon: 'STARLOCK_CAKMA',
								barkod: barkodx,
								sicil: config.sicil,
								stokNo: stokNo,
							})
							.catch((err) => {
								throw axiosError(err);
							});

						URETIM();
					}

					s7client.DBWrite(
						items[0].DBNumber,
						items[0].Start,
						items[0].Amount,
						Buffer.from([0x00]),
						function (err) {
							if (err) {
								console.error(s7client.ErrorText(err));
							}
						}
					);
				}
			});
		}, 1000);
	} else if (xConfig.mak_kod == 'A-347') {
		// HOT STAMPING - KORNİŞ LOGO MONTAJ MASASI
		let barkodx = '';
		let stokNo = '';
		let TIP = '';
		let IZGARA = '';
		let KORNIS = '';
		let HOTSTAMPING = '';
		let TEMIZLEME = '';
		durumKontrol = {
			IZGARA: 0,
			KORNIS: 0,
			HOTSTAMPING: 0,
			TEMIZLEME: 0,
		};

		let dataFunction = async function (data) {
			try {
				let buf = data.toString('ascii');
				buf = buf.replace('$', '');
				buf = buf.replace(/[\r\n]+/g, '');
				console.log('Data:', buf);

				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				stokNo = workingWorks[0]['STOKNO'];

				if (stokNo.includes('735734364.27')) {
					TIP = 'MCA_ENTY';
					IZGARA = '735734364.1';
					KORNIS = '735734366.1';
					HOTSTAMPING = false;
					TEMIZLEME = false;
				} else if (stokNo.includes('735734364.24')) {
					TIP = 'MCA_MID';
					IZGARA = '735734364.1';
					KORNIS = '735734366.1';
					HOTSTAMPING = true;
					TEMIZLEME = true;
				} else if (stokNo.includes('735734364.21')) {
					TIP = 'MCA_HIGH';
					IZGARA = '735734364.1';
					KORNIS = '735734378.2';
					HOTSTAMPING = true;
					TEMIZLEME = true;
				} else if (stokNo.includes('735734385.2')) {
					TIP = 'CROSS_ENTY';
					IZGARA = '735734385.1';
					KORNIS = '735734366.1';
					HOTSTAMPING = false;
					TEMIZLEME = false;
				} else if (stokNo.includes('735758084.21')) {
					TIP = 'CROSS_GARMIN';
					IZGARA = '735734385.1';
					KORNIS = '735734366.1';
					HOTSTAMPING = false;
					TEMIZLEME = false;
				} else {
					throw 'İşemri ile ilgili süreç kurgusu bulunamadı!';
				}

				if (buf.includes(IZGARA)) {
					durumKontrol.IZGARA = 1;

					// HOT STAMPING YAPILDIĞI KONTROL EDİLİYOR
					let seriUretimData = await axios
						.post(ServerURL + '/hotstamping/getProduction', {
							barkod: buf,
						})
						.then((results) => {
							return results['data'];
						})
						.catch((err) => {
							throw axiosError(err);
						});

					if (HOTSTAMPING) {
						if (seriUretimData['hotStampingID']) {
							durumKontrol.HOTSTAMPING = 1;
						} else {
							throw `${TIP} için HOTSTAMPING yapılmış parça olmalıdır!!!`;
						}
					} else {
						if (!seriUretimData['hotStampingID']) {
							durumKontrol.HOTSTAMPING = 1;
						} else {
							throw `${TIP} için HOTSTAMPING yapılmamış parça olmalıdır!!!`;
						}
					}

					if (TEMIZLEME) {
						if (seriUretimData['temizlemeDurum']) {
							durumKontrol.TEMIZLEME = 1;
						} else {
							throw `${TIP} için TEMIZLEME yapılmış parça olmalıdır!!!`;
						}
					} else {
						if (!seriUretimData['temizlemeDurum']) {
							durumKontrol.TEMIZLEME = 1;
						} else {
							throw `${TIP} için TEMIZLEME yapılmamış parça olmalıdır!!!`;
						}
					}

					barkodx = buf;
				} else if (buf.includes(KORNIS)) {
					durumKontrol.KORNIS = 1;
				} else {
					throw 'İşemri ile uyumlu olmayan barkod okuttunuz!';
				}

				io.sockets.emit('msg', {
					status: 'info',
					msg: 'Parça Uygun',
				});

				if (
					durumKontrol.IZGARA == 1 &&
					durumKontrol.KORNIS == 1 &&
					durumKontrol.HOTSTAMPING == 1 &&
					durumKontrol.TEMIZLEME == 1
				) {
					let config = await getConfig();

					await axios
						.post(ServerURL + '/hotstamping/setProduction', {
							operasyon: 'LOGO_MONTAJ',
							barkod: barkodx,
							sicil: config.sicil,
							stokNo: stokNo,
							tip: TIP,
						})
						.catch((err) => {
							throw axiosError(err);
						});

					URETIM();

					durumKontrol = {
						IZGARA: 0,
						KORNIS: 0,
						HOTSTAMPING: 0,
						TEMIZLEME: 0,
					};
				}
			} catch (error) {
				durumKontrol = {
					IZGARA: 0,
					KORNIS: 0,
					HOTSTAMPING: 0,
					TEMIZLEME: 0,
				};

				error = error.message || error;
				console.error(error);
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error,
					})
				);
			}
		};

		await portConnection(dataFunction);
	} else if (xConfig.mak_kod == 'A-349') {
		// HOT STAMPING - ÇAPAK TEMİZLEME BANKOSU
		let stokNo = '';
		let barkodx = '';
		await portConnection(async function (data) {
			try {
				let barkod = data.toString('ascii');
				barkod = barkod.replace('$', '');
				barkod = barkod.replace(/[\r\n]+/g, '');
				console.log('Data:', barkod);

				//MCA IZGARA OLDUĞU KONTROL EDİLİYOR
				if (!barkod.includes('735734364.1')) {
					throw 'Parça Uygun Değildir! Beklenen değer: 735734364.1';
				}

				// HOT STAMPING YAPILDIĞI KONTROL EDİLİYOR
				let seriUretimData = await axios
					.post(ServerURL + '/hotstamping/getProduction', {
						barkod: barkod,
					})
					.then((results) => {
						return results['data'];
					})
					.catch((err) => {
						throw axiosError(err);
					});

				if (!seriUretimData['hotStampingID']) {
					throw 'Hotstamping yapılmamış parça için temizleme yapılamaz!';
				}

				// STOK NUMARASI PLC'YE YAZILIYOR
				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				stokNo = workingWorks[0]['STOKNO'];

				let bufx = Buffer.from('MCA');
				s7client.DBWrite(43, 0, bufx.length, bufx, function (err, res) {
					if (err) {
						console.error(s7client.ErrorText(err));
						return;
					}
				});

				barkodx = barkod;

				io.sockets.emit('msg', {
					status: 'info',
					msg: 'Barkod Uygun',
				});
			} catch (error) {
				error = error.message || error;
				console.error(error);
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error,
					})
				);
			}
		});

		plc_connect('192.168.0.20', 0, 0);

		setInterval(() => {
			if (!s7client.Connected()) {
				console.error('PLC Bağlantısı yapılamadı!');
				return;
			}

			s7client.DBWrite(43, 5, 1, Buffer.from([0x01]), function (err) {
				if (err) {
					console.error(s7client.ErrorText(err));
					return;
				}
			});

			let items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 43,
					Start: 4,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				try {
					if (err || res[0].Result != 0) {
						console.error(s7client.ErrorText(err || res[0].Result));
						return;
					}

					let temp_digital = pad(8, digital.toString(), '0');
					let digital_last = parseInt(res[0].Data.toString('hex'), 16).toString(
						2
					);
					digital_last = pad(8, digital_last, '0');
					digital = digital_last;

					console.log('PLC SİNYALİ:', digital);

					if (digital_last[7] == 1) {
						if (digital_last[7] != temp_digital[7]) {
							let config = await getConfig();

							await axios
								.post(ServerURL + '/hotstamping/setProduction', {
									operasyon: 'TEMIZLEME',
									barkod: barkodx,
									sicil: config.sicil,
									stokNo: stokNo,
								})
								.catch((err) => {
									throw axiosError(err);
								});

							URETIM();
						} else {
							s7client.DBWrite(
								items[0].DBNumber,
								items[0].Start,
								items[0].Amount,
								Buffer.from([0x00]),
								function (err) {
									if (err) {
										console.error(s7client.ErrorText(err));
									}
								}
							);
						}
					}
				} catch (error) {
					error = error.message || error;
					console.error(error);
					io.sockets.emit(
						'263FL_RENK_BARKODU',
						JSON.stringify({
							status: 'ERROR',
							message: error,
						})
					);
				}
			});
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-KAYNAK MAKİNAS') {
		let last_button = 0;
		let parcaUygunMu = 0;

		button.watch(
			_.throttle(async function (err, value) {
				console.log('button1', value);
				if (value != last_button) {
					last_button = value;
					if (value == 1 && parcaUygunMu == 1) {
						parcaUygunMu = 0;
						URETIM();
					}
				}
			}, 200)
		);

		await portConnection();

		port.on('data', async function (data) {
			let buf = data.toString('ascii');
			console.log('Data1:', buf);
			buf = buf.split('\r\n');
			console.log('Data2:', buf);
			let barkodUretimZamani = buf[2];
			console.log('Data3:', barkodUretimZamani);
			let dununTarihi = moment().subtract(10, 'hours').unix();

			// barkod üretim tarihinin üzerinden 1 gün geçmemiş ise;
			if (barkodUretimZamani > dununTarihi) {
				parcaUygunMu = 0;

				let data = {
					status: 'ERROR',
					message:
						'Parçanın üretim zamanı üzerinden en az 10 saat geçmesi gerekmektedir. Parçaya kaynak yapmayınız.',
				};
				console.log(data);
				io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
			} else {
				parcaUygunMu = 1;

				let data = {
					status: 'OK',
					message: 'Parça üretim için uygundur!',
				};

				console.log(data);
				io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
			}
		});
	} else if (xConfig.mak_kod == '04-129' || xConfig.mak_kod == '04-197') {
		await portConnection();

		let temp = Buffer.alloc(0);
		port.on('data', async function (data) {
			try {
				console.log('Data:', data);

				temp = Buffer.concat([temp, data]);

				if (data.toString('hex').indexOf('0a') > -1) {
					let TARTI_MIN = 0;
					let TARTI_MAX = 0;
					let agirlik = temp
						.toString('ascii')
						.replace('Weight:', '')
						.replace('g', '')
						.replace(/\s/g, '');

					temp = Buffer.alloc(0);

					console.log('Ölçülen Ağırlık : ' + agirlik);

					let ISEMIRLERI = await getWorkingWorks();

					if (ISEMIRLERI.length == 0) {
						io.sockets.emit(
							'263FL_RENK_BARKODU',
							JSON.stringify({
								status: 'ERROR',
								message: 'İşemri seçili olmadan üretim yapılamaz!',
							})
						);

						return;
					}

					let MLZ_ADI = ISEMIRLERI[0]['MLZ_ADI'] || '';
					MLZ_ADI = MLZ_ADI.toUpperCase() || MLZ_ADI;

					if (MLZ_ADI.includes('LHD')) {
						//sol parça
						if (MLZ_ADI.includes('SOL')) {
							// solun solu
							TARTI_MIN = 325;
							TARTI_MAX = 385;
						} else if (MLZ_ADI.includes('SAG') || MLZ_ADI.includes('SAĞ')) {
							// solun sağı
							TARTI_MIN = 325;
							TARTI_MAX = 375;
						}
					} else if (MLZ_ADI.includes('RHD')) {
						//sağ parça
						if (MLZ_ADI.includes('SOL')) {
							// sağın solu
							TARTI_MIN = 325;
							TARTI_MAX = 375;
						} else if (MLZ_ADI.includes('SAG') || MLZ_ADI.includes('SAĞ')) {
							// sağın sağı
							TARTI_MIN = 325;
							TARTI_MAX = 395;
						}
					}

					if (agirlik > 0 && TARTI_MIN > 0 && TARTI_MAX > 0) {
						if (agirlik >= TARTI_MIN && agirlik <= TARTI_MAX) {
							io.sockets.emit('TARTIM', agirlik);

							useRelay(led, 0);

							URETIM({
								agirlik: agirlik,
							});
						} else {
							io.sockets.emit(
								'263FL_RENK_BARKODU',
								JSON.stringify({
									status: 'ERROR',
									message: `Ölçülen ağırlık (${agirlik} gr) ${TARTI_MIN} ve ${TARTI_MAX} arasında olmalıdır!`,
								})
							);

							useRelay(led, 1);
						}
					}
				}
			} catch (error) {
				console.error(error.message || error);
			}
		});
	} else if (xConfig.mak_kod == 'APR-ENJ.85') {
		plcConfig = {
			IP: '192.168.0.10',
			rack: 0,
			slot: 0,
		};

		items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLByte,
				DBNumber: 200,
				Start: 204,
				Amount: 1,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, async function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last != temp_digital) {
							if (digital[7] == 1 && temp_digital[7] != digital_last[7]) {
								console.log('SOL');

								let ISEMIRLERI = await sequelize_local.query(
									"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%SOL%'",
									{
										type: sequelize_local.QueryTypes.SELECT,
									}
								);

								URETIM({
									ISEMIRLERI: ISEMIRLERI,
								});
							}

							if (digital[2] == 1 && temp_digital[2] != digital_last[2]) {
								console.log('SAĞ');

								let ISEMIRLERI = await sequelize_local.query(
									"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%SAĞ%' OR MLZ_ADI LIKE '%SAG%'",
									{
										type: sequelize_local.QueryTypes.SELECT,
									}
								);

								URETIM({
									ISEMIRLERI: ISEMIRLERI,
								});
							}

							s7client.DBWrite(
								items[0].DBNumber,
								items[0].Start,
								items[0].Amount,
								Buffer.from([0x00]),
								function (err) {
									if (err) {
										return console.error(s7client.ErrorText(err));
									}
								}
							);
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-APT-003') {
		plcConfig = {
			IP: '192.168.0.10',
			rack: 0,
			slot: 0,
		};

		items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLByte,
				DBNumber: 200,
				Start: 204,
				Amount: 1,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last != temp_digital) {
							if (
								(digital_last[6] == 1 && temp_digital[6] != digital_last[6]) ||
								(digital_last[7] == 1 && temp_digital[7] != digital_last[7])
							) {
								URETIM();

								setTimeout(function () {
									s7client.DBWrite(
										items[0].DBNumber,
										items[0].Start,
										items[0].Amount,
										Buffer.from([0x00]),
										function (err) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}
										}
									);
								}, 100);
							}
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-APT-007') {
		plcConfig = {
			IP: '192.168.5.1',
			rack: 0,
			slot: 0,
		};

		items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLByte,
				DBNumber: 100,
				Start: 2,
				Amount: 1,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setInterval(async () => {
			try {
				let res = await s7client.ReadMultiVars(items);

				let temp_digital = pad(8, digital.toString(), '0');
				let digital_last = pad(
					8,
					parseInt(res[0].Data.toString('hex'), 16).toString(2),
					'0'
				);
				digital = digital_last;

				console.log('PLC Sinyali:', digital);

				if (digital_last == temp_digital) {
					if (
						digital_last[7] == 1 ||
						digital_last[6] == 1 ||
						digital_last[5] == 1 ||
						digital_last[4] == 1
					) {
						s7client.DBWrite(
							items[0].DBNumber,
							items[0].Start,
							items[0].Amount,
							Buffer.from([0x00])
						);
					}
				} else {
					if (digital_last[7] == 1) {
						console.log('2 SW SOL - 2 SW SAĞ ÜRETİM');

						URETIM();

						setTimeout(function () {
							URETIM();
						}, (uretimSureSiniriSn + 1) * 1000);
					} else if (digital_last[6] == 1) {
						console.log('2 HB SOL - 2 HB SAĞ ÜRETİM');

						URETIM();

						setTimeout(function () {
							URETIM();
						}, (uretimSureSiniriSn + 1) * 1000);
					} else if (digital_last[5] == 1) {
						console.log('2 SW SOL - 2 SW SAĞ - 2 HB SOL - 2 HB SAĞ ÜRETİM');

						URETIM();

						setTimeout(function () {
							URETIM();
						}, (uretimSureSiniriSn + 1) * 1000);
					} else if (digital_last[4] == 1) {
						console.log('1 SW SOL - 1 SW SAĞ - 1 HB SOL - 1 HB SAĞ ÜRETİM');

						URETIM();
					}
				}
			} catch (error) {
				console.error(error.message || error);
			}
		}, 1000);
	} else if (
		xConfig.mak_kod == 'EN-363MCA-DEF-01' ||
		xConfig.mak_kod == 'EN-363MCA-DEF-02'
	) {
		await portConnection();

		port.on('data', async function (data) {
			try {
				let buf = data.toString('ascii');
				buf = buf.replace(/(\n|\r)/g, ' ');
				buf = Buffer.from(buf.padEnd(100, ''), 'ascii');

				let status = await s7client.DBWrite(200, 104, buf.length, buf);

				if (!status) {
					io.sockets.emit(
						'263FL_RENK_BARKODU',
						JSON.stringify({
							status: 'ERROR',
							message: 'BARKODU YENİDEN OKUTTUNUZ!',
						})
					);
				}
			} catch (error) {
				console.error(error.message || error);
			}
		});

		plc_connect('192.168.0.10', 0, 0);

		setInterval(() => {
			let items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 200,
					Start: 204,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				if (err || res[0].Result != 0) {
					return console.error(s7client.ErrorText(err || res[0].Result));
				} else {
					let temp_digital = pad(8, digital.toString(), '0');
					let digital_last = pad(
						8,
						parseInt(res[0].Data.toString('hex'), 16).toString(2),
						'0'
					);
					digital = digital_last;
					console.log('PLC Sinyali:', digital);

					if (digital_last != temp_digital) {
						if (digital_last[7] == '1') {
							URETIM();
						}
					} else {
						if (digital_last[7] == '1') {
							s7client.DBWrite(
								items[0].DBNumber,
								items[0].Start,
								items[0].Amount,
								Buffer.from([0x00]),
								function (err) {
									if (err) {
										return console.error(s7client.ErrorText(err));
									}
								}
							);
						}
					}
				}
			});
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-BC3-MONT+POKE') {
		await portConnection();

		port.on('data', async function (data) {
			let buf = data.toString('ascii');
			console.log(buf);

			let result = await sequelize_local.query('SELECT * FROM WORKS', {
				type: sequelize_local.QueryTypes.SELECT,
			});

			if (result.length > 1) {
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message:
							'Bu makinede aynı anda 1 tane işemri ile çalışabilirsiniz!',
					})
				);

				return;
			}

			if (result.length == 0) {
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: 'İşemri seçili olmadığı için işleme devam edilemiyor!',
					})
				);

				return;
			}

			result = result[0] || {};

			if (!buf.includes(result.ISEMRI_NO)) {
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: 'Okunan barkod ile işemri uyumsuz!!!',
					})
				);

				return;
			}

			console.log('!!!!!!!!!! --- KLEMPLERİ AÇ --- !!!!!!!!!!');

			// **** klemp açma işlemi ****
			setTimeout(function () {
				s7client.DBWrite(15, 0, 1, Buffer.from([0x01]), function (err) {
					if (err) {
						return console.error(s7client.ErrorText(err));
					}
				});
			}, 100);
		});

		plcConfig = {
			IP: '192.168.0.1',
			rack: 0,
			slot: 0,
		};

		items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLByte,
				DBNumber: 11,
				Start: 52,
				Amount: 1,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setTimeout(function () {
			s7client.DBWrite(
				items[0].DBNumber,
				items[0].Start,
				items[0].Amount,
				Buffer.from([0x00]),
				function (err) {
					if (err) {
						return console.error(s7client.ErrorText(err));
					}
				}
			);
		}, 100);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last != temp_digital) {
							if (digital_last[7] == 1) {
								URETIM();

								setTimeout(function () {
									s7client.DBWrite(
										items[0].DBNumber,
										items[0].Start,
										items[0].Amount,
										Buffer.from([0x00]),
										function (err) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}
										}
									);
								}, 100);
							}
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-CUV-KAMERA') {
		await portConnection();

		port.on('data', async function (data) {
			let buf = data.toString('ascii');
			console.log('Okunan Barkod:', buf);

			buf = Buffer.from(buf.padEnd(100, ' '));
			let status = await s7client.DBWrite(200, 478, 100, buf);

			if (!status) {
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: "BARKOD PLC'YE YAZILAMADI! TEKRAR OKUTUNUZ!",
					})
				);
			}
		});

		let plcConfig = {
			IP: '192.168.0.10',
			rack: 0,
			slot: 0,
		};

		let items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLByte,
				DBNumber: 200,
				Start: 226,
				Amount: 2,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setInterval(async () => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last[7] != temp_digital[7] && digital_last[7] == 1) {
							URETIM();
						} else {
							if (digital_last[7] == 1) {
								s7client.DBWrite(
									items[0].DBNumber,
									items[0].Start,
									items[0].Amount,
									Buffer.from([0x00]),
									function (err) {
										if (err) {
											console.error(s7client.ErrorText(err));
										}
									}
								);
							}
						}
					}
				});
			}
		}, 200);
	} else if (xConfig.mak_kod == 'EN-004-2700') {
		let last_button1 = 0;
		let last_button2 = 0;

		button.watch(
			_.throttle(async function (err, value) {
				console.log('SOL SINYAL', value);

				if (last_button1 != value) {
					last_button1 = value;

					if (value == 1) {
						let ISEMIRLERI = await sequelize_local.query(
							"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%SOL%';",
							{
								type: sequelize_local.QueryTypes.SELECT,
							}
						);

						URETIM({
							ISEMIRLERI: ISEMIRLERI,
						});
					}
				}
			}, 200)
		);

		button2.watch(
			_.throttle(async function (err, value) {
				console.log('SAG SINYAL', value);

				if (last_button2 != value) {
					last_button2 = value;

					if (value == 1) {
						let ISEMIRLERI = await sequelize_local.query(
							"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%SAĞ%'",
							{
								type: sequelize_local.QueryTypes.SELECT,
							}
						);

						URETIM({
							ISEMIRLERI: ISEMIRLERI,
						});
					}
				}
			}, 200)
		);
	} else if (xConfig.mak_kod == 'APR-ENJ.95') {
		let last_button1 = 0;
		let last_button2 = 0;

		button.watch(
			_.throttle(async function (err, value) {
				console.log('SOL SINYAL', value);

				if (last_button1 != value) {
					last_button1 = value;

					if (value == 1) {
						let ISEMIRLERI = await sequelize_local.query(
							"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%SOL%';",
							{
								type: sequelize_local.QueryTypes.SELECT,
							}
						);

						URETIM({
							ISEMIRLERI: ISEMIRLERI,
						});
					}
				}
			}, 200)
		);

		button2.watch(
			_.throttle(async function (err, value) {
				console.log('SAG SINYAL', value);

				if (last_button2 != value) {
					last_button2 = value;

					if (value == 1) {
						let ISEMIRLERI = await sequelize_local.query(
							"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%SAĞ%' OR MLZ_ADI LIKE '%SAG%'",
							{
								type: sequelize_local.QueryTypes.SELECT,
							}
						);

						URETIM({
							ISEMIRLERI: ISEMIRLERI,
						});
					}
				}
			}, 200)
		);
	} else if (xConfig.mak_kod == 'MNT-MASA-009') {
		await portConnection();

		port.on('data', async function (data) {
			const buf = data.toString('ascii');
			const buf2 = buf.split('\r\n');

			let renk = buf2[1].substr(11, 3).replace(/[^0-9]/g, '');

			let result = await sequelize_local.query(
				'SELECT ISEMRI_NO FROM ISEMIRLERI WHERE MLZ_ADI LIKE :STOK_NO LIMIT 1',
				{
					type: sequelize_local.QueryTypes.SELECT,
					replacements: {
						STOK_NO: '%-' + renk,
					},
				}
			);

			if (result.length == 0) {
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: 'AÇIK İŞ EMRİ BULUNAMADI !',
					})
				);

				return;
			}

			io.sockets.emit(
				'263FL_RENK_BARKODU',
				JSON.stringify({
					status: 'OK',
					message: 'RENK : ' + renk + ' Etiket Alınız !',
				})
			);

			let isemriNo = result[0].ISEMRI_NO;
			await changeWork([isemriNo]);

			URETIM();
		});
	} else if (xConfig.mak_kod == 'APR-MON.021') {
		await portConnection();

		port.on('data', async function (data) {
			const buf = data.toString('ascii').split('\r\n');
			let barkodStokNo = buf[1].replace(/[^a-zA-Z0-9]/g, '');

			const workingWorks = await getWorkingWorks();

			if (workingWorks.length > 0) {
				if (barkodStokNo.includes('MK31V045A06AC3ZHE')) {
					const buf3 = Buffer.from(pad(barkodStokNo, 100), 'ascii');

					s7client.DBWrite(200, 2, buf3.length, buf3, function (err, res) {
						if (err) {
							return console.error(s7client.ErrorText(err));
						}

						console.log(
							'sendPlcSTOK => Stok numarası yazılıyor...',
							barkodStokNo
						);
					});

					s7client.DBWrite(
						200,
						206,
						1,
						Buffer.from('1', 'ascii'),
						function (err, res) {
							if (err) {
								return console.error(s7client.ErrorText(err));
							}

							console.log(
								'sendPlcSTOK => Üretim başlat yazılıyor...',
								barkodStokNo
							);
						}
					);
				} else {
					let data = {
						status: 'ERROR',
						message: 'Okunan barkod bu parça için uygun değildir!',
					};
					console.log(data);
					io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
				}
			} else {
				let data = {
					status: 'ERROR',
					message: 'SEÇİLİ İŞEMRİ BULUNAMADI!',
				};
				console.log(data);
				io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
			}
		});

		let plcConfig = {
			IP: '192.168.0.1',
			rack: 0,
			slot: 0,
		};

		let items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLBit,
				DBNumber: 200,
				Start: 0,
				Amount: 1,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last != temp_digital) {
							if (digital_last[7] == 1) {
								URETIM();

								setTimeout(function () {
									s7client.DBWrite(
										items[0].DBNumber,
										items[0].Start,
										items[0].Amount,
										Buffer.from([0x00]),
										function (err) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}
										}
									);
								}, 100);
							}
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'APR-MON.022') {
		await portConnection();

		port.on('data', async function (data) {
			const buf = data.toString('ascii');
			console.log('Data1:', buf);
			const buf2 = buf.split('\r\n');
			console.log('Data2:', buf2);
			let barkodStokNo = buf2[1].replace(/[^a-zA-Z0-9]/g, '');
			console.log('Data3:', barkodStokNo);

			const workingWorks = await getWorkingWorks();

			if (workingWorks.length > 0) {
				if (barkodStokNo.includes('MK31V045A06BC3ZHE')) {
					const buf3 = Buffer.from(pad(barkodStokNo, 100), 'ascii');

					s7client.DBWrite(200, 104, buf3.length, buf3, function (err, res) {
						if (err) {
							return console.error(s7client.ErrorText(err));
						}

						console.log(
							'sendPlcSTOK => Stok numarası yazılıyor...',
							barkodStokNo
						);
					});

					s7client.DBWrite(
						200,
						207,
						1,
						Buffer.from('1', 'ascii'),
						function (err, res) {
							if (err) {
								return console.error(s7client.ErrorText(err));
							}

							console.log(
								'sendPlcSTOK => Üretim başlat yazılıyor...',
								barkodStokNo
							);
						}
					);
				} else {
					let data = {
						status: 'ERROR',
						message: 'Okunan barkod bu parça için uygun değildir!',
					};
					console.log(data);
					io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
				}
			} else {
				let data = {
					status: 'ERROR',
					message: 'SEÇİLİ İŞEMRİ BULUNAMADI!',
				};
				console.log(data);
				io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
			}
		});

		let plcConfig = {
			IP: '192.168.0.1',
			rack: 0,
			slot: 0,
		};

		let items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLBit,
				DBNumber: 200,
				Start: 1,
				Amount: 1,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last != temp_digital) {
							if (digital_last[7] == 1) {
								URETIM();

								setTimeout(function () {
									s7client.DBWrite(
										items[0].DBNumber,
										items[0].Start,
										items[0].Amount,
										Buffer.from([0x00]),
										function (err) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}
										}
									);
								}, 100);
							}
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-APT-023') {
		await portConnection();

		port.on('data', async function (data) {
			try {
				let buf = data.toString('ascii');
				let buf2 = buf.split('\r\n');
				let renk = buf2[1].substr(10, 3).replace(/[^0-9]/g, '');

				let result = await sequelize_local.query(
					'SELECT ISEMRI_NO FROM ISEMIRLERI WHERE STOK_NO LIKE :STOK_NO LIMIT 1',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							STOK_NO: '%' + renk + '.4',
						},
					}
				);

				result = result[0];
				console.log(result);

				if (!result) {
					throw `${renk} RENK İÇİN AÇIK İŞ EMRİ BULUNAMADI!`;
				}

				await changeWork([result.ISEMRI_NO]);

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'OK',
						message: 'RENK : ' + renk + ' Makineyi Çalıştırınız !',
					})
				);
			} catch (error) {
				error = error.message || error;
				console.log(error);

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error,
					})
				);
			}
		});

		plc_connect('192.168.0.40', 0, 2);

		setInterval(() => {
			if (s7client.Connected()) {
				let items = [
					{
						Area: s7client.S7AreaDB,
						WordLen: s7client.S7WLByte,
						DBNumber: 100,
						Start: 5,
						Amount: 1,
					},
				];

				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						if (digital_last[7] == 1) {
							if (digital_last != temp_digital) {
								URETIM();
							}

							s7client.DBWrite(100, 5, 1, Buffer.from([0x00]), function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							});
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-APT-024') {
		let barkodKontrolDurum = 0;
		await portConnection();

		port.on('data', async function (data) {
			const buf = data.toString('ascii');
			const buf2 = buf.split('\r\n');
			let renk = buf2[0].substr(5, 4).replace(/[^0-9]/g, '');

			let result = await sequelize_local.query(
				'SELECT ISEMRI_NO FROM ISEMIRLERI WHERE STOK_NO LIKE :STOK_NO LIMIT 1',
				{
					type: sequelize_local.QueryTypes.SELECT,
					replacements: {
						STOK_NO: '%-' + renk + '.2',
					},
				}
			);

			result = result[0];

			if (!result) {
				let data = {
					status: 'ERROR',
					message: `${renk} RENK İÇİN AÇIK İŞ EMRİ BULUNAMADI!`,
				};
				console.log(data);
				io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));

				barkodKontrolDurum = 0;
				return;
			}

			await changeWork([result.ISEMRI_NO]);

			let data = {
				status: 'OK',
				message: 'RENK : ' + renk + ' Makineyi Çalıştırınız !',
			};
			io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));

			barkodKontrolDurum = 1;
		});

		plc_connect('192.168.0.40', 0, 2);

		setInterval(() => {
			if (s7client.Connected()) {
				let items = [
					{
						Area: s7client.S7AreaDB,
						WordLen: s7client.S7WLByte,
						DBNumber: 100,
						Start: 1,
						Amount: 1,
					},
				];

				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						if (digital_last[7] == 1) {
							if (digital_last != temp_digital && barkodKontrolDurum == 1) {
								barkodKontrolDurum = 0;
								URETIM();
							} else {
								setTimeout(function () {
									s7client.DBWrite(
										100,
										1,
										1,
										Buffer.from([0x00]),
										function (err) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}
										}
									);
								}, 500);
							}
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-MASA-001') {
		let FL263_TIP = 0;
		let FL263_DURUM = 0;

		await portConnection();

		port.on('data', function (data) {
			const buf = data.toString('ascii');
			console.log('Data:', buf);
			const buf2 = buf.split('\r\n');
			//temp = Buffer.concat([temp, data]);
			console.log(buf2);
			if (FL263_DURUM == 0) {
				if (buf2[1] == '7355975890.5') {
					FL263_TIP = 1;
					let data = {
						status: 'OK',
						message: 'KAMERALI RENK BARKODUNU OKUTUNUZ',
					};
					console.log(data);
					io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
					FL263_DURUM = 1;
				} else if (buf2[0].match(/DOFL\dD601/gm)) {
					FL263_TIP = 2;
					let data = {
						status: 'OK',
						message: 'KAMERASIZ RENK BARKODUNU OKUTUNUZ',
					};
					console.log(data);
					io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
					FL263_DURUM = 1;
				} else {
					let data = {
						status: 'ERROR',
						message: 'KABUK BARKODUNU OKUTUNUZ',
					};
					console.log(data);
					io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
				}
			} else if (FL263_DURUM == 1) {
				if (buf2.length == 1) {
					if (FL263_TIP == 1) {
						var renk = buf2[0].substr(5, 4).replace(/[^0-9]/g, '');
						console.log(renk);
						sequelize_local
							.query(
								'SELECT ISEMRI_NO FROM ISEMIRLERI WHERE STOK_NO LIKE :STOK_NO LIMIT 1',
								{
									type: sequelize_local.QueryTypes.SELECT,
									replacements: {
										STOK_NO: '%' + renk + '.33%',
									},
								}
							)
							.then(async function (result) {
								if (result.length > 0) {
									ISEMIRLERI = result;

									var data = {
										status: 'OK',
										message: 'RENK : ' + renk + ' Barkodu Alınız !',
									};
									console.log(result);
									io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
									FL263_DURUM = 0;
									let tempWork = [result[0].ISEMRI_NO];
									console.log(tempWork);
									await changeWork(tempWork);
									URETIM();
								} else {
									var data = {
										status: 'ERROR',
										message: 'AÇIK İŞ EMRİ BULUNAMADI !',
									};
									console.log(data);
									io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
									FL263_DURUM = 0;
								}
							})
							.catch(function (e) {
								console.log(e);
							});
					}

					if (FL263_TIP == 2) {
						var renk = buf2[0].substr(5, 4).replace(/[^0-9]/g, '');
						sequelize_local
							.query(
								'SELECT * FROM ISEMIRLERI WHERE STOK_NO LIKE :STOK_NO LIMIT 1',
								{
									type: sequelize_local.QueryTypes.SELECT,
									replacements: {
										STOK_NO: '%-3-' + renk + '%',
									},
								}
							)
							.then(async function (result) {
								if (result.length > 0) {
									ISEMIRLERI = result;
									var data = {
										status: 'OK',
										message: 'RENK : ' + renk + ' Barkodu Alınız !',
									};
									io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));

									let tempWork = [result[0].ISEMRI_NO];
									console.log(tempWork);
									await changeWork(tempWork);
									URETIM();
								} else {
									var data = {
										status: 'ERROR',
										message: 'AÇIK İŞ EMRİ BULUNAMADI !',
									};
									console.log(data);
									io.sockets.emit('263FL_RENK_BARKODU', JSON.stringify(data));
									FL263_DURUM = 0;
								}
							})
							.catch(function (e) {
								console.log(e);
								//res.status(404).json(exjson);
							});
					}
				}
			}
		});
	} else if (xConfig.mak_kod == 'APR-ENJ.96' || xConfig.mak_kod == 'A-345') {
		let plcConfig = {
			IP: '192.168.0.10',
			rack: 0,
			slot: 0,
		};

		let items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLByte,
				DBNumber: 200,
				Start: 204,
				Amount: 1,
			},
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLReal,
				DBNumber: 200,
				Start: 210,
				Amount: 1,
			},
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLReal,
				DBNumber: 200,
				Start: 214,
				Amount: 1,
			},
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLReal,
				DBNumber: 200,
				Start: 218,
				Amount: 1,
			},
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLReal,
				DBNumber: 200,
				Start: 222,
				Amount: 1,
			},
		];
		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);
		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;
						console.log('PLC Sinyali:', digital);
						if (digital_last != temp_digital) {
							if (digital_last[7] == 1) {
								let barkod = '';
								if (res[1].Data.readFloatBE(0).toFixed(2) > 0) {
									barkod += res[1].Data.readFloatBE(0).toFixed(2) + ' ';
								}
								if (res[2].Data.readFloatBE(0).toFixed(2) > 0) {
									barkod += res[2].Data.readFloatBE(0).toFixed(2) + ' ';
								}
								if (res[3].Data.readFloatBE(0).toFixed(2) > 0) {
									barkod += res[3].Data.readFloatBE(0).toFixed(2) + ' ';
								}
								if (res[4].Data.readFloatBE(0).toFixed(2) > 0) {
									barkod += res[4].Data.readFloatBE(0).toFixed(2) + ' ';
								}
								URETIM({
									barkod: barkod,
								});

								setTimeout(function () {
									s7client.DBWrite(
										items[0].DBNumber,
										items[0].Start,
										items[0].Amount,
										Buffer.from([0x00]),
										function (err) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}
										}
									);
								}, 100);
							}
						}
					}
				});
			}
		}, 1000);
	} else if (
		xConfig.mak_kod == 'MON-356-0001.1' ||
		xConfig.mak_kod == 'MON-356-0001.2'
	) {
		let parcaUygunMu = 0;
		await portConnection();

		port.on('data', async function (data) {
			try {
				parcaUygunMu = 0;
				let buf = data.toString('ascii');
				buf = buf.split('\r\n');
				let barkodUretimZamani = buf[2];
				let controlDate = moment().subtract(1, 'hours').unix();

				if (barkodUretimZamani && barkodUretimZamani > controlDate) {
					throw 'Parçanın üretim zamanı üzerinden en az 1 saat geçmesi gerekmektedir.';
				}

				parcaUygunMu = 1;

				if (buf.length < 1) {
					io.sockets.emit(
						'263FL_RENK_BARKODU',
						JSON.stringify({
							status: 'ERROR',
							message: 'YANLIŞ BARKOD OKUTTUNUZ!',
						})
					);

					return;
				}

				let barkod = buf[1];
				let tip = barkod.indexOf('735670166.01') ? '057' : '058';
				let renk = barkod.substr(13, 3);

				let ISEMIRLERI = await sequelize_local.query(
					'SELECT ISEMRI_NO FROM ISEMIRLERI WHERE MLZ_ADI_2 = :MLZ_ADI_2 order by ISEMRI_NO desc LIMIT 1;',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							MLZ_ADI_2: tip + '-' + renk,
						},
					}
				);

				if (ISEMIRLERI.length == 0) {
					io.sockets.emit(
						'263FL_RENK_BARKODU',
						JSON.stringify({
							status: 'ERROR',
							message: 'AÇIK İŞ EMRİ BULUNAMADI !',
						})
					);

					return;
				}

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'OK',
						message: `RENK: ${renk} Makineyi Çalıştırınız!`,
					})
				);

				await changeWork([ISEMIRLERI[0].ISEMRI_NO]);
			} catch (error) {
				parcaUygunMu = 0;
				console.error(error.message || error);

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error.message || error,
					})
				);
			}
		});

		plc_connect('192.168.0.10', 0, 0);

		const DB = xConfig.mak_kod == 'MON-356-0001.1' ? 201 : 200;

		setInterval(() => {
			var items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: DB,
					Start: 108,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				if (err || res[0].Result != 0) {
					err = res ? res[0].Result : err;
					console.log(
						' >> ReadMultiVars failed. Code #' +
							err +
							' - ' +
							s7client.ErrorText(err)
					);
				} else {
					let temp_digital = pad(8, digital.toString(), '0');
					let digital_last = pad(
						8,
						parseInt(res[0].Data.toString('hex'), 16).toString(2),
						'0'
					);
					digital = digital_last;
					console.log(digital_last, parcaUygunMu);

					if (digital_last[7] != temp_digital[7]) {
						if (digital_last[7] == '1') {
							s7client.WriteArea(
								s7client.S7AreaDB,
								DB,
								108 * 8,
								1,
								s7client.S7WLBit,
								Buffer.from([0x00]),
								function (err) {
									if (err) {
										return console.log(
											' >> ABRead failed. Code #' +
												err +
												' - ' +
												s7client.ErrorText(err)
										);
									}
								}
							);

							if (parcaUygunMu == 1) {
								parcaUygunMu = 0;
								URETIM();
							} else {
								io.sockets.emit(
									'263FL_RENK_BARKODU',
									JSON.stringify({
										status: 'ERROR',
										message:
											'Parçanın üretim zamanı üzerinden en az 1 saat geçmediği için etiket alınamadı!',
									})
								);
							}
						}
					} else {
						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							122 * 8,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.log(
										' >> ABRead failed. Code #' +
											err +
											' - ' +
											s7client.ErrorText(err)
									);
								}
							}
						);
					}
				}
			});
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-APT-005') {
		await portConnection();

		port.on('data', async function (data) {
			try {
				let buf = data.toString('ascii');
				buf = buf.split(';');

				let barkod = buf[0] || '';
				let tip = barkod.substr(0, 3).replace(/[^0-9]/g, '');
				let renk = barkod.substr(5, 4).replace(/[^0-9]/g, '');

				let ISEMRI = await sequelize_local.query(
					'SELECT ISEMRI_NO FROM ISEMIRLERI WHERE MLZ_ADI_2 LIKE :MLZ_ADI_2 order by ISEMRI_NO desc LIMIT 1;',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							MLZ_ADI_2: '%' + tip + '-' + renk + '%',
						},
					}
				);

				ISEMRI = ISEMRI[0];

				if (!ISEMRI) {
					throw `TİP: ${tip} RENK: ${renk} İÇİN AÇIK İŞ EMRİ BULUNAMADI!`;
				}

				await changeWork([ISEMRI.ISEMRI_NO]);

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'OK',
						message: `RENK: ${renk} Makineyi Çalıştırınız!`,
					})
				);

				parcaUygunMu = 1;
			} catch (error) {
				console.error(error);
				parcaUygunMu = 0;

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error.message || error,
					})
				);
			}
		});

		plc_connect('192.168.5.1', 0, 0);

		setInterval(() => {
			let items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 100,
					Start: 0,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				if (err || res[0].Result != 0) {
					return console.error(s7client.ErrorText(err || res[0].Result));
				} else {
					let config = await getConfig();

					if (!config) {
						console.error('Config olmadan bu işleme devam edilemez!');
						return;
					}

					let temp_digital = pad(8, digital.toString(), '0');
					let digital_last = pad(
						8,
						parseInt(res[0].Data.toString('hex'), 16).toString(2),
						'0'
					);
					digital = digital_last;
					console.log('PLC Sinyali:', digital);

					if (digital_last != temp_digital) {
						if (digital_last[7] == '1' && digital_last[7] != temp_digital[7]) {
							URETIM();
						}
					} else {
						setTimeout(function () {
							s7client.DBWrite(
								items[0].DBNumber,
								items[0].Start,
								items[0].Amount,
								Buffer.from([0x00]),
								function (err) {
									if (err) {
										return console.error(s7client.ErrorText(err));
									}
								}
							);
						}, 100);
					}
				}
			});
		}, 1000);
	} else if (xConfig.mak_kod == 'MNT-APT-006') {
		await portConnection();
		let parcaUygunMu = 0;

		port.on('data', async function (data) {
			try {
				parcaUygunMu = 0;
				let buf = data.toString('ascii');
				buf = buf.split(';');
				let barkodUretimZamani = buf[4];
				let controlDate = moment().subtract(2, 'hours').unix();

				if (barkodUretimZamani && barkodUretimZamani > controlDate) {
					throw 'Parçanın üretim zamanı üzerinden en az 2 saat geçmesi gerekmektedir. Parçaya kaynak yapmayınız.';
				}

				let barkod = buf[0] || '';
				let tip = barkod.substr(0, 3).replace(/[^0-9]/g, '');
				let renk = barkod.substr(5, 4).replace(/[^0-9]/g, '');

				let ISEMRI = await sequelize_local.query(
					'SELECT ISEMRI_NO FROM ISEMIRLERI WHERE MLZ_ADI_2 LIKE :MLZ_ADI_2 order by ISEMRI_NO desc LIMIT 1;',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							MLZ_ADI_2: '%' + tip + '-' + renk + '%',
						},
					}
				);

				ISEMRI = ISEMRI[0];

				if (!ISEMRI) {
					throw `TİP: ${tip} RENK: ${renk} İÇİN AÇIK İŞ EMRİ BULUNAMADI!`;
				}

				await changeWork([ISEMRI.ISEMRI_NO]);

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'OK',
						message: `RENK: ${renk} Makineyi Çalıştırınız!`,
					})
				);

				parcaUygunMu = 1;
			} catch (error) {
				console.error(error);
				parcaUygunMu = 0;

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error.message || error,
					})
				);
			}
		});

		plc_connect('192.168.5.1', 0, 0);

		setInterval(() => {
			let items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 100,
					Start: 1,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				if (err || res[0].Result != 0) {
					return console.error(s7client.ErrorText(err || res[0].Result));
				} else {
					let temp_digital = pad(8, digital.toString(), '0');
					let digital_last = pad(
						8,
						parseInt(res[0].Data.toString('hex'), 16).toString(2),
						'0'
					);
					digital = digital_last;
					console.log('PLC Sinyali:', digital);

					if (digital_last != temp_digital) {
						if (
							digital_last[7] == '1' &&
							digital_last[7] != temp_digital[7] &&
							parcaUygunMu == 1
						) {
							parcaUygunMu = 0;
							URETIM();
						}
					} else {
						s7client.DBWrite(
							items[0].DBNumber,
							items[0].Start,
							items[0].Amount,
							Buffer.from([0x00]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					}
				}
			});
		}, 1000);
	} else if (xConfig.mak_kod == '02-004') {
		let plcConfig = {
			IP: '192.168.0.2',
			rack: 0,
			slot: 0,
		};

		let items = [
			{
				Area: s7client.S7AreaDB,
				WordLen: s7client.S7WLByte,
				DBNumber: 9,
				Start: 0,
				Amount: 1,
			},
		];

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		let remainTime = 0;
		setInterval(() => {
			remainTime = remainTime - 1000;
		}, 1000);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last != temp_digital && temp_digital == '00000000') {
							if (
								(digital_last[6] == 1 || digital_last[7] == 1) &&
								remainTime <= 0
							) {
								remainTime = 10 * 1000;
								URETIM();

								setTimeout(function () {
									s7client.DBWrite(
										items[0].DBNumber,
										items[0].Start,
										items[0].Amount,
										Buffer.from([0x00]),
										function (err) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}
										}
									);
								}, 100);
							}
						}
					}
				});
			}
		}, 1000);
	} else if (xConfig.mak_kod == 'APR-MON.090') {
		const DB = 206;

		await portConnection();
		let parcaUygunMu = 0;

		port.on('data', async function (data) {
			try {
				parcaUygunMu = 0;
				let parcaTip = '';
				let parcaRenk = '';

				let buf = data.toString('ascii');
				let barcodeRead = buf
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$');

				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				const stokNo = workingWorks[0]['STOKNO'];
				console.log(barcodeRead);

				const barkodKontrol = await vwBarkodKontrol(barcodeRead, stokNo);

				console.log(workingWorks[0]);
				console.log(workingWorks[0].MLZ_ADI);

				if (workingWorks[0].MLZ_ADI.includes('TKM BENZIN')) {
					tip = 'TKM BEN';
				} else if (workingWorks[0].MLZ_ADI.includes('LKM')) {
					tip = 'LKM TIG';
				} else if (workingWorks[0].MLZ_ADI.includes('TKM PHEV')) {
					tip = 'TKM PHEV';
				} else if (workingWorks[0].MLZ_ADI.includes('TKM DIESEL')) {
					tip = 'TKM DIZ';
				}

				let renk = workingWorks[0].MLZ_ADI.split(' ');

				renk = renk[renk.length - 1];

				console.log(renk, tip);

				const barcodeBuffer = await vwBufferSet(barcodeRead);

				s7client.DBWrite(
					DB,
					0,
					barcodeBuffer.length,
					barcodeBuffer,
					function (err, res) {
						if (err) {
							console.log(
								' >> ABRead failed. Code #' +
									err +
									' - ' +
									s7client.ErrorText(err)
							);
						}

						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							244 * 8 + 0,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					}
				);

				const renkBuffer = await vwBufferSet(renk, 5);

				s7client.DBWrite(
					DB,
					102,
					renkBuffer.length,
					renkBuffer,
					function (err, res) {
						if (err) {
							console.log(
								' >> ABRead failed. Code #' +
									err +
									' - ' +
									s7client.ErrorText(err)
							);
						}
					}
				);

				const tipBuffer = await vwBufferSet(tip, 7);

				s7client.DBWrite(
					DB,
					110,
					tipBuffer.length,
					tipBuffer,
					function (err, res) {
						if (err) {
							console.log(
								' >> ABRead failed. Code #' +
									err +
									' - ' +
									s7client.ErrorText(err)
							);
						}
					}
				);

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'OK',
						message: `Makineyi Çalıştırınız!`,
					})
				);

				parcaUygunMu = 1;
			} catch (error) {
				console.log('hata burada');
				console.error(error);
				parcaUygunMu = 0;
				console.log(JSON.stringify(error));
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error.error || error,
					})
				);
			}
		});

		plc_connect('192.168.0.10', 0, 1);

		setInterval(() => {
			let items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: DB,
					Start: 244,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				if (err || res[0].Result != 0) {
					return console.error(s7client.ErrorText(err || res[0].Result));
				} else {
					let temp_digital = pad(8, digital.toString(), '0');
					let digital_last = pad(
						8,
						parseInt(res[0].Data.toString('hex'), 16).toString(2),
						'0'
					);
					digital = digital_last;
					console.log('PLC Sinyali:', digital);

					if (digital_last != temp_digital) {
						if (digital_last[5] == '1' && digital_last[5] != temp_digital[5]) {
							URETIM();

							s7client.WriteArea(
								s7client.S7AreaDB,
								DB,
								244 * 8 + 2,
								1,
								s7client.S7WLBit,
								Buffer.from([0x00]),
								function (err) {
									if (err) {
										return console.error(s7client.ErrorText(err));
									}
								}
							);
						}
					}
				}
			});

			s7client.WriteArea(
				s7client.S7AreaDB,
				DB,
				244 * 8 + 1,
				1,
				s7client.S7WLBit,
				Buffer.from([0x01]),
				function (err) {
					if (err) {
						return console.error(s7client.ErrorText(err));
					}
				}
			);
		}, 1000);
	} else if (
		xConfig.mak_kod == 'APR-MON.094' ||
		xConfig.mak_kod == 'APR-MON.093'
	) {
		await portConnection();
		let parcaUygunMu = 0;

		const DB = xConfig.mak_kod == 'APR-MON.094' ? 326 : 226;

		port.on('data', async function (data) {
			try {
				parcaUygunMu = 0;
				let buf = data.toString('ascii');
				let barcodeRead = buf
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$');

				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				let barkodDurum = await barkodCheck(barcodeRead);

				if (barkodDurum == true) throw `Bu Barkod Daha Önce Okutulmuş`;

				console.log(data, barcodeRead);

				const [uResults, uMetadata] = await sequelize_local.query(
					'UPDATE PARCA_BARKODLARI SET durum = 1,BARKOD=:barcodeRead WHERE INSTR(:data, ICERIK) > 0',
					{
						type: sequelize_local.QueryTypes.UPDATE,
						replacements: {
							data: data,
							barcodeRead: barcodeRead,
						},
					}
				);

				let parcaStok = await sequelize_local.query(
					'SELECT * FROM PARCA_BARKODLARI WHERE INSTR(:data, ICERIK) > 0',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							data: data,
						},
					}
				);

				if (parcaStok.length == 0) throw `Yanlış Barkod Okutuldu`;

				console.log(parcaStok);
				console.log(digital[6]);

				if (parcaStok[0].ACIKLAMA.includes('Hinge')) {
					const buffer = await vwBufferSet(barcodeRead);

					s7client.DBWrite(DB, 204, buffer.length, buffer, function (err, res) {
						if (err) {
							console.log(
								' >> ABRead failed. Code #' +
									err +
									' - ' +
									s7client.ErrorText(err)
							);
						}

						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							306 * 8 + 2,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					});
				} else if (parcaStok[0].ACIKLAMA.includes('Flap') && digital[6] == 1) {
					console.log('flap');
					const buffer = await vwBufferSet(barcodeRead);

					s7client.DBWrite(DB, 102, buffer.length, buffer, function (err, res) {
						if (err) {
							console.log(
								' >> ABRead failed. Code #' +
									err +
									' - ' +
									s7client.ErrorText(err)
							);
						}

						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							306 * 8 + 1,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					});

					let results = await sequelize_local.query(
						'SELECT * FROM PARCA_BARKODLARI WHERE durum = 0',
						{
							type: sequelize_local.QueryTypes.SELECT,
						}
					);

					if (results.length == 0) {
						URETIM();
					}
				} else if (parcaStok[0].ACIKLAMA.includes('Housing')) {
					console.log('housing');
					const buffer = await vwBufferSet(barcodeRead);

					s7client.DBWrite(DB, 0, buffer.length, buffer, function (err, res) {
						if (err) {
							console.log(
								' >> ABRead failed. Code #' +
									err +
									' - ' +
									s7client.ErrorText(err)
							);
						}

						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							306 * 8 + 0,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					});
				}
			} catch (error) {
				console.log('hata burada');
				console.error(error);
				parcaUygunMu = 0;
				console.log(JSON.stringify(error));
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error.error,
					})
				);
			}
		});

		plc_connect('192.168.0.10', 0, 1);

		setInterval(() => {
			let items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: DB,
					Start: 922,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				if (err || res[0].Result != 0) {
					return console.error(s7client.ErrorText(err || res[0].Result));
				} else {
					let temp_digital = pad(8, digital.toString(), '0');
					let digital_last = pad(
						8,
						parseInt(res[0].Data.toString('hex'), 16).toString(2),
						'0'
					);
					digital = digital_last;
					console.log('PLC Sinyali:', digital, digital[6]);

					s7client.WriteArea(
						s7client.S7AreaDB,
						DB,
						922 * 8 + 0,
						1,
						s7client.S7WLBit,
						Buffer.from([0x01]),
						function (err) {
							if (err) {
								return console.error(s7client.ErrorText(err));
							}
						}
					);
				}
			});
		}, 1000);
	} else if (xConfig.mak_kod == 'APR-MON.059') {
		await portConnection();
		let parcaUygunMu = 0;

		const DB = 206;

		port.on('data', async function (data) {
			try {
				parcaUygunMu = 0;
				let buf = data.toString('ascii');
				let barcodeRead = buf
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$');

				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				let barkodDurum = await barkodCheck(barcodeRead);

				if (barkodDurum == true) throw `Bu Barkod Daha Önce Okutulmuş`;

				console.log(data, barcodeRead);

				const [uResults, uMetadata] = await sequelize_local.query(
					'UPDATE PARCA_BARKODLARI SET durum = 1,BARKOD=:barcodeRead WHERE INSTR(:data, ICERIK) > 0',
					{
						type: sequelize_local.QueryTypes.UPDATE,
						replacements: {
							data: data,
							barcodeRead: barcodeRead,
						},
					}
				);

				let parcaStok = await sequelize_local.query(
					'SELECT * FROM PARCA_BARKODLARI WHERE INSTR(:data, ICERIK) > 0',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							data: data,
						},
					}
				);

				if (parcaStok.length == 0) throw `Yanlış Barkod Okutuldu`;

				let tip = '';

				if (parcaStok[0].ACIKLAMA.includes('OUTER LHD')) tip = 'SLEST';
				else if (parcaStok[0].ACIKLAMA.includes('INNER LHD')) tip = 'SLDES';
				else if (parcaStok[0].ACIKLAMA.includes('INNER RHD')) tip = 'SGDES';
				else if (parcaStok[0].ACIKLAMA.includes('OUTER RHD')) tip = 'SGEST';
				else
					console.log(
						'!!!!!!!! Yanlış Tip Barkod Okutuldu stok tanımı kontrol ediniz !!!!!!!!'
					);

				console.log(tip);

				const buffer = await vwBufferSet(barcodeRead);

				s7client.DBWrite(
					DB,
					0,
					buffer.length,
					buffer,
					async function (err, res) {
						if (err) {
							console.log(
								' >> ABRead failed. Code #' +
									err +
									' - ' +
									s7client.ErrorText(err)
							);
						}

						const tipBuffer = await vwBufferSet(tip, 5);

						s7client.DBWrite(
							DB,
							110,
							tipBuffer.length,
							tipBuffer,
							function (err, res) {
								if (err) {
									console.log(
										' >> ABRead failed. Code #' +
											err +
											' - ' +
											s7client.ErrorText(err)
									);
								}
							}
						);

						let barkodDurumBuffer = Buffer.allocUnsafe(2);
						barkodDurumBuffer.writeInt16BE('1', 0);

						s7client.DBWrite(
							DB,
							120,
							barkodDurumBuffer.length,
							barkodDurumBuffer,
							function (err, res) {
								if (err) {
									console.log(
										' >> ABRead failed. Code #' +
											err +
											' - ' +
											s7client.ErrorText(err)
									);
								}
							}
						);

						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							126 * 8 + 0,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					}
				);
			} catch (error) {
				console.log('hata burada');
				console.error(error);
				parcaUygunMu = 0;
				console.log(JSON.stringify(error));
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error.error,
					})
				);
			}
		});

		plc_connect('192.168.0.10', 0, 1);

		let slStatus = 0;
		let sgStatus = 0;

		setInterval(() => {
			let items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLBit,
					DBNumber: DB,
					Start: 128 * 8,
					Amount: 1,
				},
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLBit,
					DBNumber: DB,
					Start: 129 * 8,
					Amount: 1,
				},
			];

			s7client.ReadMultiVars(items, async function (err, res) {
				if (err || res[0].Result != 0) {
					return console.error(s7client.ErrorText(err || res[0].Result));
				} else {
					let digital_last = pad(
						8,
						parseInt(res[0].Data.toString('hex'), 16).toString(2),
						'0'
					);

					console.log('SOL PLC DURUM', digital_last);

					if (digital_last != slStatus && digital_last[7] == 1) {
						let ISEMIRLERI = await sequelize_local.query(
							"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%LHD%'",
							{
								type: sequelize_local.QueryTypes.SELECT,
							}
						);

						console.log(ISEMIRLERI);

						URETIM({
							ISEMIRLERI: ISEMIRLERI,
						});

						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							128 * 8 + 0,
							1,
							s7client.S7WLBit,
							Buffer.from([0x00]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					}

					slStatus = digital_last;

					digital_last = pad(
						8,
						parseInt(res[1].Data.toString('hex'), 16).toString(2),
						'0'
					);

					console.log('SAĞ PLC DURUM', digital_last);

					if (digital_last != sgStatus && digital_last[7] == 1) {
						let ISEMIRLERI = await sequelize_local.query(
							"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%RHD%'",
							{
								type: sequelize_local.QueryTypes.SELECT,
							}
						);

						console.log(ISEMIRLERI);

						URETIM({
							ISEMIRLERI: ISEMIRLERI,
						});

						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							129 * 8 + 0,
							1,
							s7client.S7WLBit,
							Buffer.from([0x00]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					}

					sgStatus = digital_last;

					s7client.WriteArea(
						s7client.S7AreaDB,
						DB,
						127 * 8 + 0,
						1,
						s7client.S7WLBit,
						Buffer.from([0x01]),
						function (err) {
							if (err) {
								return console.error(s7client.ErrorText(err));
							}
						}
					);
				}
			});
		}, 1000);
	} else if (xConfig.mak_kod == 'APR-MON.061') {
		await portConnection();
		let parcaUygunMu = 0;

		const DB = 206;

		port.on('data', async function (data) {
			try {
				parcaUygunMu = 0;
				let buf = data.toString('ascii');
				let barcodeRead = buf
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$');

				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				//let barkodDurum = await barkodCheck(barcodeRead);

				//if (barkodDurum == true) {
				//	throw `Bu Barkod Daha Önce Okutulmuş`;
				// }

				const [uResults, uMetadata] = await sequelize_local.query(
					'UPDATE PARCA_BARKODLARI SET durum = 1,BARKOD=:barcodeRead WHERE INSTR(:data, ICERIK) > 0',
					{
						type: sequelize_local.QueryTypes.UPDATE,
						replacements: {
							data: data,
							barcodeRead: barcodeRead,
						},
					}
				);

				let parcaStok = await sequelize_local.query(
					'SELECT * FROM PARCA_BARKODLARI WHERE INSTR(:data, ICERIK) > 0',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							data: data,
						},
					}
				);

				if (parcaStok.length == 0) throw `Yanlış Barkod Okutuldu`;

				console.log(parcaStok);
				console.log(digital[6]);

				let tip = '';

				if (parcaStok[0].ACIKLAMA.includes('LHD')) tip = 'SLDES';
				else if (parcaStok[0].ACIKLAMA.includes('RHD')) tip = 'SGDES';

				console.log(tip);

				const buffer = await vwBufferSet(barcodeRead);

				s7client.DBWrite(
					DB,
					0,
					buffer.length,
					buffer,
					async function (err, res) {
						if (err) {
							console.log(
								' >> ABRead failed. Code #' +
									err +
									' - ' +
									s7client.ErrorText(err)
							);
						}

						const tipBuffer = await vwBufferSet(tip, 5);

						s7client.DBWrite(
							DB,
							110,
							tipBuffer.length,
							tipBuffer,
							function (err, res) {
								if (err) {
									console.log(
										' >> ABRead failed. Code #' +
											err +
											' - ' +
											s7client.ErrorText(err)
									);
								}
							}
						);

						let barkodDurumBuffer = Buffer.allocUnsafe(2);
						barkodDurumBuffer.writeInt16BE('1', 0);

						s7client.DBWrite(
							DB,
							120,
							barkodDurumBuffer.length,
							barkodDurumBuffer,
							function (err, res) {
								if (err) {
									console.log(
										' >> ABRead failed. Code #' +
											err +
											' - ' +
											s7client.ErrorText(err)
									);
								}
							}
						);

						s7client.WriteArea(
							s7client.S7AreaDB,
							DB,
							126 * 8 + 0,
							1,
							s7client.S7WLBit,
							Buffer.from([0x01]),
							function (err) {
								if (err) {
									return console.error(s7client.ErrorText(err));
								}
							}
						);
					}
				);
			} catch (error) {
				console.log('hata burada');
				console.error(error);
				parcaUygunMu = 0;
				console.log(JSON.stringify(error));
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error.error || error,
					})
				);
			}
		});

		plc_connect('192.168.0.10', 0, 1);

		let solStatus = 0;
		let sagStatus = 0;

		setInterval(async () => {
			let solOK = await readIntFromPLC(DB, 128); // 1 => OK 3 => Şartlı OK
			let sagOK = await readIntFromPLC(DB, 130); // 1 => OK 3 => Şartlı OK

			console.log(solOK, sagOK);

			if (solOK != solStatus && solOK > 0) {
				let ISEMIRLERI = await sequelize_local.query(
					"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%LHD%'",
					{
						type: sequelize_local.QueryTypes.SELECT,
					}
				);

				console.log(ISEMIRLERI);

				URETIM({
					ISEMIRLERI: ISEMIRLERI,
				});

				await writeIntToPLC(DB, 128, 0);
			}

			solStatus = solOK;

			if (sagOK != sagStatus && sagOK > 0) {
				let ISEMIRLERI = await sequelize_local.query(
					"SELECT * FROM WORKS WHERE MLZ_ADI LIKE '%RHD%'",
					{
						type: sequelize_local.QueryTypes.SELECT,
					}
				);

				console.log(ISEMIRLERI);

				URETIM({
					ISEMIRLERI: ISEMIRLERI,
				});

				await writeIntToPLC(DB, 130, 0);
			}

			sagStatus = sagOK;
		}, 1000);
	} else if (xConfig.mak_kod == 'APR-MON.105') {
		await portConnection();
		let parcaUygunMu = 0;

		const DB = 35;

		port.on('data', async function (data) {
			try {
				parcaUygunMu = 0;
				let buf = data.toString('ascii');
				let barcodeRead = buf
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$')
					.replace('\r\n', '$');

				let workingWorks = await getWorkingWorks();

				if (workingWorks.length == 0) {
					throw 'İşemri seçili olmadığı için işleme devam edilemiyor!';
				}

				let barkodDurum = await barkodCheck(barcodeRead);

				if (barkodDurum == true) {
					throw `Bu Barkod Daha Önce Okutulmuş`;
				}

				const [uResults, uMetadata] = await sequelize_local.query(
					'UPDATE PARCA_BARKODLARI SET durum = 1,BARKOD=:barcodeRead WHERE INSTR(:data, ICERIK) > 0',
					{
						type: sequelize_local.QueryTypes.UPDATE,
						replacements: {
							data: data,
							barcodeRead: barcodeRead,
						},
					}
				);

				let parcaStok = await sequelize_local.query(
					'SELECT * FROM PARCA_BARKODLARI WHERE INSTR(:data, ICERIK) > 0',
					{
						type: sequelize_local.QueryTypes.SELECT,
						replacements: {
							data: data,
						},
					}
				);

				if (parcaStok.length == 0) throw `Yanlış Barkod Okutuldu`;

				console.log(parcaStok);

				let tip = 0;

				if (parcaStok[0].STOK_ADI.includes('STAR')) tip = 1;
				else if (parcaStok[0].STOK_ADI.includes('ROUND')) tip = 2;

				console.log(tip);

				await writeIntToPLC(DB, 0, tip);
				await writeBitToPLC(DB, 2, 2, 1);

				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'OK',
						message: `Makineyi Çalıştırınız!`,
					})
				);
			} catch (error) {
				console.log('hata burada');
				console.error(error);
				parcaUygunMu = 0;
				console.log(JSON.stringify(error));
				io.sockets.emit(
					'263FL_RENK_BARKODU',
					JSON.stringify({
						status: 'ERROR',
						message: error.error || error,
					})
				);
			}
		});

		plc_connect('192.168.0.1', 0, 1);
		let plcStatus;

		setInterval(async () => {
			try {
				const status = await readBitFromPLC(DB, 2, 0); // 1 => OK 3 => Şartlı OK

				if (status != plcStatus && status == 1) {
					await URETIM();
					await writeBitToPLC(DB, 2, 0, 0);
				}
			} catch (ex) {
				console.log(ex);
			}

			// // plcStatus = status;
		}, 1000);
	} else {
		let plcConfig;
		let items;

		if (xConfig.mak_kod == 'MON-356-ND-1') {
			plcConfig = {
				IP: '192.168.0.10',
				rack: 0,
				slot: 0,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 200,
					Start: 308,
					Amount: 1,
				},
			];
		} else if (xConfig.mak_kod == 'MON-356-ND-2') {
			plcConfig = {
				IP: '192.168.0.10',
				rack: 0,
				slot: 0,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 200,
					Start: 322,
					Amount: 1,
				},
			];
		} else if (xConfig.mak_kod == 'MNT-APT-002') {
			plcConfig = {
				IP: '192.168.0.10',
				rack: 0,
				slot: 0,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 100,
					Start: 0,
					Amount: 1,
				},
			];
		} else if (
			xConfig.mak_kod == 'APR-ENJ.86' ||
			xConfig.mak_kod == 'APR-ENJ.82' ||
			xConfig.mak_kod == 'A-345' ||
			xConfig.mak_kod == 'APR-ENJ.84' ||
			xConfig.mak_kod == 'APR-ENJ.83' ||
			xConfig.mak_kod == 'APR-ENJ.92' ||
			xConfig.mak_kod == 'APR-ENJ.170' ||
			xConfig.mak_kod == 'APR-ENJ.173' ||
			xConfig.mak_kod == 'A-342' ||
			xConfig.mak_kod == 'MNT-APT-001'
		) {
			plcConfig = {
				IP: '192.168.0.10',
				rack: 0,
				slot: 0,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 200,
					Start: 204,
					Amount: 1,
				},
			];
		} else if (xConfig.mak_kod == 'A-318') {
			plcConfig = {
				IP: '192.168.0.101',
				rack: 0,
				slot: 0,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 200,
					Start: 204,
					Amount: 1,
				},
			];
		} else if (xConfig.mak_kod == 'MB-001') {
			plcConfig = {
				IP: '192.168.0.1',
				rack: 0,
				slot: 0,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 9,
					Start: 52,
					Amount: 1,
				},
			];
		} else if (xConfig.mak_kod == 'MNT-APT-022') {
			plcConfig = {
				IP: '192.168.0.40',
				rack: 0,
				slot: 2,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 100,
					Start: 0,
					Amount: 1,
				},
			];
		} else if (xConfig.mak_kod == 'APR-MON.023') {
			plcConfig = {
				IP: '192.168.0.12',
				rack: 0,
				slot: 0,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 200,
					Start: 204,
					Amount: 1,
				},
			];
		} else if (xConfig.mak_kod == 'APR-MON.027') {
			plcConfig = {
				IP: '192.168.0.1',
				rack: 0,
				slot: 0,
			};

			items = [
				{
					Area: s7client.S7AreaDB,
					WordLen: s7client.S7WLByte,
					DBNumber: 200,
					Start: 204,
					Amount: 1,
				},
			];
		} else {
			return;
		}

		plc_connect(plcConfig.IP, plcConfig.rack, plcConfig.slot);

		setInterval(() => {
			if (s7client.Connected()) {
				s7client.ReadMultiVars(items, function (err, res) {
					if (err || res[0].Result != 0) {
						return console.error(s7client.ErrorText(err || res[0].Result));
					} else {
						let temp_digital = pad(8, digital.toString(), '0');
						let digital_last = pad(
							8,
							parseInt(res[0].Data.toString('hex'), 16).toString(2),
							'0'
						);
						digital = digital_last;

						console.log('PLC Sinyali:', digital);

						if (digital_last != temp_digital) {
							if (digital_last[7] == 1) {
								URETIM();

								setTimeout(function () {
									s7client.DBWrite(
										items[0].DBNumber,
										items[0].Start,
										items[0].Amount,
										Buffer.from([0x00]),
										function (err) {
											if (err) {
												return console.error(s7client.ErrorText(err));
											}
										}
									);
								}, 100);
							}
						}
					}
				});
			}
		}, 1000);
	}
}

async function vwBarkodKontrol(okunanBarkod, stok_kod) {
	console.log(
		ServerURL + `/vwPokaYoke/${okunanBarkod}/${stok_kod}/${onceki_operasyon}`
	);

	try {
		let results = await axios
			.get(
				ServerURL +
					`/vwPokaYoke/${okunanBarkod}/${stok_kod}/${onceki_operasyon}`
			)
			.catch((err) => {
				throw axiosError(err);
			});
		return results;
	} catch (err) {
		console.log(err);
		throw err;
	}
}

async function vwBuffer(okunanBarkod, renk, type, status) {
	var b1 = new Buffer([0x64, 0x64]);

	var buf = Buffer.from(pad(okunanBarkod, 100), 'ascii');

	var b2 = new Buffer([0x5, 0x5]);

	var buf2 = Buffer.from(pad(renk, 5), 'ascii');

	var b3 = new Buffer([0x00, 0x07, 0x07]);

	var buf3 = Buffer.from(pad(type, 7), 'ascii');

	var b4 = new Buffer([0x00]);

	let BARKOD_DURUM = Buffer.allocUnsafe(2);
	BARKOD_DURUM.writeInt16BE(status, 0);

	var b5 = new Buffer([0x01]);

	var arr = [b1, buf, b2, buf2, b3, buf3, b4, BARKOD_DURUM, b5];

	return Buffer.concat(arr);
}

async function vwBufferSet(barcode, length = 100) {
	var b1 = new Buffer([length, length]);

	var barcodeBuffer = Buffer.from(pad(barcode, length), 'ascii');

	var arr = [b1, barcodeBuffer];

	return Buffer.concat(arr);
}

function barkodCheck(barkod) {
	return new Promise(async (resolve, reject) => {
		let result = await sequelize_local.query(
			'SELECT * FROM uretim WHERE prevBarkod like :BARKOD ',
			{
				type: sequelize_local.QueryTypes.SELECT,
				replacements: {
					BARKOD: barkod,
				},
			}
		);

		if (result.length > 0) {
			resolve(true);
		} else {
			resolve(false);
		}
	});
}

function getPrevBarkod(ISEMRI) {
	return new Promise(async (resolve, reject) => {
		try {
			console.log(ISEMRI);
			let xdata = await sequelize_local.query(
				'SELECT * FROM PARCA_BARKODLARI WHERE durum = 1 and ISEMRI_NO = :ISEMRI',

				{
					type: sequelize_local.QueryTypes.SELECT,
					replacements: {
						ISEMRI: ISEMRI,
					},
				}
			);
			if (xdata.length == 0) {
				resolve('');
			} else {
				let prevBarkod = xdata.map((u) => u.BARKOD).join(';');

				console.log('Prev Barkod ', prevBarkod);
				resolve(prevBarkod);
			}
		} catch (ex) {
			reject(ex);
		}
	});
}

function dogrulamaBarkodSifirla(ISEMRI) {
	return new Promise(async (resolve, reject) => {
		let xdata = await sequelize_local.query(
			'UPDATE PARCA_BARKODLARI SET durum = 0, BARKOD = null where ISEMRI_NO = :ISEMRI',

			{
				type: sequelize_local.QueryTypes.UPDATE,
				replacements: {
					ISEMRI: ISEMRI,
				},
			}
		);

		resolve(true);
	});
}

// ***********************************************************
// ***********************************************************
// PLC Read Write Functions
// ***********************************************************
// ***********************************************************

function readBitFromPLC(dbNumber, startAddres, bit) {
	return new Promise(async (resolve, reject) => {
		try {
			s7client.ReadArea(
				s7client.S7AreaDB,
				dbNumber,
				startAddres * 8 + bit,
				1,
				s7client.S7WLBit,
				function (err, data) {
					if (err) {
						throw `
							 >> readBitFromPLC failed. Code # +
								${err} +
								' - ' +
								${s7client.ErrorText(err)}
						`;
					}
					resolve(data.readInt8(0));
				}
			);
		} catch (ex) {
			reject(ex);
		}
	});
}
function writeBitToPLC(dbNumber, startAddres, bit, data) {
	return new Promise(async (resolve, reject) => {
		if (data == 0 || data == 1) {
			try {
				s7client.WriteArea(
					s7client.S7AreaDB,
					dbNumber,
					startAddres * 8 + bit,
					1,
					s7client.S7WLBit,
					data ? Buffer.from([0x01]) : Buffer.from([0x00]),
					function (err) {
						if (err) {
							reject(s7client.ErrorText(err));
						}
						resolve(true);
					}
				);
			} catch (ex) {
				reject(ex);
			}
		} else {
			reject('Data Hatalı');
		}
	});
}

function writeIntToPLC(dbNumber, startAddres, data) {
	return new Promise(async (resolve, reject) => {
		try {
			let buffer = Buffer.allocUnsafe(2);
			buffer.writeInt16BE(data, 0);

			s7client.DBWrite(
				dbNumber,
				startAddres,
				buffer.length,
				buffer,
				function (err, res) {
					if (err) {
						console.log(
							' >> writeIntToPLC failed. Code #' +
								err +
								' - ' +
								s7client.ErrorText(err)
						);
					}
					resolve(true);
				}
			);
		} catch (ex) {
			reject(ex);
		}
	});
}

function readIntFromPLC(dbNumber, startAddres) {
	return new Promise(async (resolve, reject) => {
		try {
			s7client.ReadArea(
				s7client.S7AreaDB,
				dbNumber,
				startAddres,
				1,
				s7client.S7WLWord,
				function (err, data) {
					if (err) {
						throw `
							 >> readIntFromPLC failed. Code # +
								${err} +
								' - ' +
								${s7client.ErrorText(err)}
						`;
					}

					resolve(data.readInt16BE());
				}
			);
		} catch (ex) {
			reject(ex);
		}
	});
}

function writeStringToPLC(dbNumber, startAddres, data, length = 100) {
	return new Promise(async (resolve, reject) => {
		try {
			const buffer = await vwBufferSet(data, length);

			s7client.DBWrite(
				dbNumber,
				startAddres,
				buffer.length,
				buffer,
				function (err, res) {
					if (err) {
						throw `
							 >> writeStringToPLC failed. Code # +
								${err} +
								' - ' +
								${s7client.ErrorText(err)}
						`;
					}
					resolve(true);
				}
			);
		} catch (ex) {
			reject(ex);
		}
	});
}

function readStringFromPLC(dbNumber, startAddres, length = 100) {
	return new Promise(async (resolve, reject) => {
		try {
			s7client.DBRead(dbNumber, startAddres + 2, length, function (err, data) {
				if (err) {
					throw `
							 >> readStringFromPLC failed. Code # +
								${err} +
								' - ' +
								${s7client.ErrorText(err)}
						`;
				}
				resolve(data.toString());
			});
		} catch (ex) {
			reject(ex);
		}
	});
}

/////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////
// THE END
/////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////
061;
