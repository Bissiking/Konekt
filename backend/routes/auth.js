const express = require('express');
const axios = require('axios');
const router = express.Router();
require('dotenv').config();

// === Variables env ===
const {
    KYROS_CLIENT_ID,
    KYROS_CLIENT_SECRET,
    KYROS_REDIRECT_URI,
    KYROS_AUTH_URL
} = process.env;

// === /auth/config ===
router.get('/config', (req, res) => {
    res.json({
        client_id: KYROS_CLIENT_ID,
        auth_url: KYROS_AUTH_URL,
        redirect_uri: KYROS_REDIRECT_URI
    });
});


// === /auth/check ===
router.get('/check', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Non connecté' });
    }
});

// === /auth/refresh ===
router.post('/refresh', async (req, res) => {
    const refreshToken = req.session.refreshToken;
    if (!refreshToken) {
        return res.status(401).json({ error: 'Aucun refresh token' });
    }

    try {
        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: KYROS_CLIENT_ID,
            client_secret: KYROS_CLIENT_SECRET
        });

        const tokenRes = await axios.post(KYROS_TOKEN_ENDPOINT, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token, refresh_token: newRefresh } = tokenRes.data;

        req.session.accessToken = access_token;
        if (newRefresh) req.session.refreshToken = newRefresh;

        res.cookie('access_token', access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: 3600 * 1000
        });

        res.json({ access_token });
    } catch (err) {
        console.error('[KYROS][refresh] ❌', err.response?.data || err.message);
        res.status(500).json({ error: 'Échec du refresh' });
    }
});

// === /auth/logout ===
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('access_token');
        res.json({ success: true });
    });
});

module.exports = router;
