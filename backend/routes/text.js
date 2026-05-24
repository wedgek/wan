const express = require('express')
const { requireAuth } = require('./auth')
const textChatRouter = require('./textChat')

const router = express.Router()
router.use(requireAuth)
router.use('/chat', textChatRouter)

module.exports = router
