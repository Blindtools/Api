const { Client, LocalAuth, Buttons } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Initialize client with LocalAuth (auto session)
const client = new Client({
    authStrategy: new LocalAuth() // saves session automatically in .wwebjs_auth
});

// Generate QR code on first run
client.on('qr', (qr) => {
    console.log('🔐 Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// When ready
client.on('ready', () => {
    console.log('✅ WhatsApp Bot is ready!');

    // Example buttons
    const buttons = new Buttons(
        'Hello 👋, choose an option below:',
        [
            { body: '📞 Call Me' },
            { body: '🌐 Visit Website' },
            { body: '💬 Chat with Support' }
        ],
        'Blind Tools',
        'Select one option 👇'
    );

    // Replace with your phone number
    const number = '919876543210@c.us'; // format: countrycode+number@c.us
    client.sendMessage(number, buttons);

    // Example: send to group
    // const groupId = '123456789-123456@g.us';
    // client.sendMessage(groupId, buttons);
});

// Handle replies
client.on('message', async (msg) => {
    console.log(`📩 Message from ${msg.from}: ${msg.body}`);

    if (msg.body === '📞 Call Me') {
        msg.reply('📞 My number: +91 9876543210');
    } else if (msg.body === '🌐 Visit Website') {
        msg.reply('🌐 Visit: https://blindtools.in');
    } else if (msg.body === '💬 Chat with Support') {
        msg.reply('💬 Support team will contact you soon!');
    }
});

client.initialize();

