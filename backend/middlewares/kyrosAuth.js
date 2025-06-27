function kyrosAuth(req, res, next) {
    if (req.session && req.session.user) {
        req.user = req.session.user;
        return next();
    }

    return res.status(401).json({ error: 'Non authentifié' });
}

module.exports = kyrosAuth;
