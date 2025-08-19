const express = require('express')
const db = require('../utils/db')
const cors = require("cors");

const app = express()
const port = process.env.PORT || 3000

app.use(express.json());
app.use(cors());

app.get('/', async (req,res)=> {

    try {
        const [rows] = await db.query('SELECT * FROM cards');
        res.json(rows);
    } catch(e) {
        console.log(e)
        res.status(500).json({ error: e.message});
    }

})

app.get('/cards/:id/info', async (req, res) => {
  const cardId = req.params.id;

  try {
    // Select both balance and card_name
    const [rows] = await db.query(
      'SELECT balance, card_name FROM cards WHERE card_id = ?',
      [cardId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({ 
      card_id: cardId, 
      balance: rows[0].balance, 
      card_name: rows[0].card_name 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});



app.post('/cards/:id/topup', async (req, res) => {
  const cardId = req.params.id;
  const { amount } = req.body; // Added total_km

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    await db.query('UPDATE cards SET balance = balance + ? WHERE card_id = ?', [amount, cardId]);

    const [rows] = await db.query('SELECT balance FROM cards WHERE card_id = ?', [cardId]);
    const updatedBalance = rows[0].balance;

    await db.query(
      'INSERT INTO transactions (card_id, transaction_type, amount, new_balance) VALUES (?, "topup", ?, ?)',
      [cardId, amount, updatedBalance]
    );


    res.json({ message: `Card ${cardId} topped up with ${amount}`, balance: updatedBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});



app.post('/cards/:id/spend', async (req, res) => {
  const cardId = req.params.id;
  const { amount, fuel_price } = req.body; 

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    const [cardRows] = await db.query('SELECT balance FROM cards WHERE card_id = ?', [cardId]);
    if (cardRows.length === 0) return res.status(404).json({ error: 'Card not found' });

    const currentBalance = parseFloat(cardRows[0].balance);
    if (currentBalance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    liters = amount / fuel_price;

    await db.query('UPDATE cards SET balance = balance - ? WHERE card_id = ?', [amount, cardId]);

    const updatedBalance = currentBalance - amount;

    await db.query(
      'INSERT INTO transactions (card_id, transaction_type, amount, new_balance, fuel_price, liters) VALUES (?, "spend", ?, ?, ?, ?)',
      [cardId, amount, updatedBalance, fuel_price || 0, liters]
    );

    res.json({
      message: `Card ${cardId} spent ${amount}`,
      remaining_balance: updatedBalance,
      liters
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/cards/:id/transactions', async (req, res) => {
  const cardId = req.params.id;

  try {

    const [cardRows] = await db.query('SELECT * FROM cards WHERE card_id = ?', [cardId]);
    if (cardRows.length === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const [transactions] = await db.query(
      'SELECT transaction_id, transaction_type, amount, new_balance, fuel_price, liters, transaction_date FROM transactions WHERE card_id = ? ORDER BY transaction_date DESC',
      [cardId]
    );

    res.json({ card_id: cardId, transactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/cards/:id/latest-fuel-price', async (req, res) => {
  const cardId = req.params.id;

  try {
    // Get the latest 'spend' transaction for this card
    const [rows] = await db.query(
      `SELECT fuel_price 
       FROM transactions 
       WHERE card_id = ? AND transaction_type = "spend" 
       ORDER BY transaction_date DESC 
       LIMIT 1`,
      [cardId]
    );

    if (rows.length === 0 || rows[0].fuel_price === null) {
      return res.status(404).json({ error: 'No fuel price found' });
    }

    res.json({ latest_fuel_price: parseFloat(rows[0].fuel_price) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/cards/add', async (req, res) => {
  try {
    const { name, balance } = req.body;

    if (!name || isNaN(balance)) {
      return res.status(400).json({ error: 'Invalid name or balance' });
    }

    const [result] = await db.query(
      'INSERT INTO cards (card_name, balance) VALUES (?, ?)',
      [name, balance]
    );

    // result.insertId contains the ID of the inserted row
    const newCard = {
      id: result.insertId,
      name,
      balance: parseFloat(balance),
    };

    res.status(201).json(newCard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});


app.delete('/cards/:id/delete', async (req, res) => {
  try {
    const cardId = parseInt(req.params.id);
    if (isNaN(cardId)) {
      return res.status(400).json({ error: 'Invalid card ID' });
    }

    const result = await db.query('DELETE FROM cards WHERE card_id = ?', [cardId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({ message: 'Card deleted successfully' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/cards/:id/summary', async (req, res) => {
  try {
    const cardId = parseInt(req.params.id);
    if (isNaN(cardId)) {
      return res.status(400).json({ error: 'Invalid card ID' });
    }

    // Optional date range from query parameters
    const start = req.query.start;
    const end = req.query.end;

    const conditions = ['card_id = ?', 'transaction_type = ?'];
    const params = [cardId, 'spend'];

    if (start) {
      conditions.push('transaction_date >= ?');
      params.push(new Date(start));
    }
    if (end) {
      conditions.push('transaction_date <= ?');
      params.push(new Date(end));
    }

    const sql = `SELECT SUM(amount) AS totalSpent, SUM(liters) AS totalLiters 
                 FROM transactions 
                 WHERE ${conditions.join(' AND ')}`;

    const [rows] = await db.query(sql, params);

    const cardInfo = await db.query('SELECT *from cards WHERE card_id = ?', [cardId])

    res.json({
      totalSpent: rows[0].totalSpent || 0,
      totalLiters: rows[0].totalLiters || 0,
      cardInfo: cardInfo[0][0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});



app.listen(port , '0.0.0.0' ,() => {
    console.log('Console is up on '+ port)
})