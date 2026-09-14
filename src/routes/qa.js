// src/routes/qa.js
const express = require('express');
const { getOne, getAll, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../lib/helpers');

const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();

router.get('/business/:businessId', async (req, res) => {
  const questions = await getAll(
    `SELECT q.id, q.question, q.created_at, u.name AS user_name
     FROM qa_questions q JOIN users u ON u.id = q.user_id WHERE q.business_id = $1 ORDER BY q.created_at DESC`,
    [req.params.businessId]
  );
  const withAnswers = [];
  for (const q of questions) {
    const answers = await getAll(
      `SELECT a.id, a.answer, a.is_owner, a.created_at, u.name AS user_name
       FROM qa_answers a JOIN users u ON u.id = a.user_id WHERE a.question_id = $1 ORDER BY a.created_at ASC`,
      [q.id]
    );
    withAnswers.push({ ...q, answers });
  }
  res.json({ questions: withAnswers });
});

router.post('/business/:businessId', requireAuth, async (req, res) => {
  const { question } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: 'Question text is required.' });
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.businessId]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  const { rows } = await run('INSERT INTO qa_questions (business_id, user_id, question) VALUES ($1,$2,$3) RETURNING id', [req.params.businessId, req.user.id, question.trim()]);
  await notify(biz.owner_id, 'question', `${req.user.name} asked a question on ${biz.name}.`, biz.id);
  res.status(201).json({ id: rows[0].id });
});

router.post('/:questionId/answers', requireAuth, async (req, res) => {
  const { answer } = req.body || {};
  if (!answer || !answer.trim()) return res.status(400).json({ error: 'Answer text is required.' });
  const question = await getOne('SELECT * FROM qa_questions WHERE id = $1', [req.params.questionId]);
  if (!question) return res.status(404).json({ error: 'Question not found.' });
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [question.business_id]);
  const isOwner = biz.owner_id === req.user.id ? 1 : 0;
  await run('INSERT INTO qa_answers (question_id, user_id, answer, is_owner) VALUES ($1,$2,$3,$4)', [req.params.questionId, req.user.id, answer.trim(), isOwner]);
  if (question.user_id !== req.user.id) await notify(question.user_id, 'answer', 'Your question was answered.', biz.id);
  res.status(201).json({ ok: true });
});

module.exports = router;
