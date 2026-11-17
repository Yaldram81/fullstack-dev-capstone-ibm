/* jshint esversion: 8 */
const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3030;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Resolve JSON data file paths
const reviewsPath = fs.existsSync(path.join(__dirname, 'reviews.json'))
  ? path.join(__dirname, 'reviews.json')
  : path.join(__dirname, 'data', 'reviews.json');
const dealershipsPath = fs.existsSync(path.join(__dirname, 'dealerships.json'))
  ? path.join(__dirname, 'dealerships.json')
  : path.join(__dirname, 'data', 'dealerships.json');

const reviews_data = JSON.parse(fs.readFileSync(reviewsPath, 'utf8'));
const dealerships_data = JSON.parse(fs.readFileSync(dealershipsPath, 'utf8'));

// Local in-memory store for fallback if MongoDB is unavailable
let localReviews = [...(reviews_data.reviews || [])];
let localDealerships = [...(dealerships_data.dealerships || [])];
let useMongo = false;

const Reviews = require('./review');
const Dealerships = require('./dealership');

const mongoUrl = process.env.MONGO_URL || "mongodb://mongo_db:27017/";
mongoose.connect(mongoUrl, {
  dbName: 'dealershipsDB',
  serverSelectionTimeoutMS: 2000,
}).then(async () => {
  useMongo = true;
  console.log("Connected to MongoDB successfully");
  try {
    await Reviews.deleteMany({});
    await Reviews.insertMany(reviews_data.reviews);
    await Dealerships.deleteMany({});
    await Dealerships.insertMany(dealerships_data.dealerships);
    console.log("Database seeded successfully in MongoDB");
  } catch (err) {
    console.error("Error seeding MongoDB:", err.message);
  }
}).catch((err) => {
  useMongo = false;
  console.log("MongoDB unavailable, running in fallback mode with local data:", err.message);
});

// Express route to home
app.get('/', async (req, res) => {
  res.send("Welcome to the Mongoose API");
});

// Express route to fetch all reviews
app.get('/fetchReviews', async (req, res) => {
  try {
    if (useMongo) {
      const documents = await Reviews.find();
      return res.json(documents);
    }
    res.json(localReviews);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching documents' });
  }
});

// Express route to fetch reviews by a particular dealer
app.get('/fetchReviews/dealer/:id', async (req, res) => {
  try {
    if (useMongo) {
      const documents = await Reviews.find({ dealership: req.params.id });
      return res.json(documents);
    }
    const dealerId = parseInt(req.params.id, 10);
    const documents = localReviews.filter(
      (r) => r.dealership === dealerId || r.dealership === req.params.id || String(r.dealership) === String(req.params.id)
    );
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching documents' });
  }
});

// Express route to fetch all dealerships
app.get('/fetchDealers', async (req, res) => {
  try {
    if (useMongo) {
      const dealerships = await Dealerships.find();
      return res.status(200).json(dealerships);
    }
    res.status(200).json(localDealerships);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching dealerships' });
  }
});

// Express route to fetch dealerships by a particular state
app.get('/fetchDealers/:state', async (req, res) => {
  const state = req.params.state;
  try {
    if (useMongo) {
      const dealerships = await Dealerships.find({ state });
      if (dealerships.length === 0) {
        return res.status(404).json({ error: `No dealerships found in state: ${state}` });
      }
      return res.json(dealerships);
    }
    const dealerships = localDealerships.filter(
      (d) => d.state && d.state.toLowerCase() === state.toLowerCase()
    );
    if (dealerships.length === 0) {
      return res.status(404).json({ error: `No dealerships found in state: ${state}` });
    }
    res.json(dealerships);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching dealerships by state' });
  }
});

// Express route to fetch dealers by ID
app.get('/fetchDealer/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    if (useMongo) {
      const dealership = await Dealerships.findOne({ id });
      if (!dealership) {
        return res.status(404).json({ error: `No dealership found with ID: ${id}` });
      }
      return res.json(dealership);
    }
    const dealership = localDealerships.find((d) => d.id === id);
    if (!dealership) {
      return res.status(404).json({ error: `No dealership found with ID: ${id}` });
    }
    res.json(dealership);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching dealership by ID' });
  }
});

// Express route to insert review
app.post('/insert_review', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let data;
    if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    } else if (Buffer.isBuffer(req.body)) {
      data = JSON.parse(req.body.toString('utf8'));
    } else {
      data = req.body;
    }

    let new_id = 1;
    if (useMongo) {
      const documents = await Reviews.find().sort({ id: -1 });
      if (documents.length > 0) {
        new_id = (documents[0].id || 0) + 1;
      }
      const review = new Reviews({
        id: new_id,
        name: data.name,
        dealership: data.dealership,
        review: data.review,
        purchase: data.purchase,
        purchase_date: data.purchase_date,
        car_make: data.car_make,
        car_model: data.car_model,
        car_year: data.car_year,
      });
      const savedReview = await review.save();
      return res.json(savedReview);
    }

    if (localReviews.length > 0) {
      new_id = Math.max(...localReviews.map((r) => r.id || 0)) + 1;
    }
    const newReview = {
      id: new_id,
      name: data.name,
      dealership: data.dealership,
      review: data.review,
      purchase: data.purchase,
      purchase_date: data.purchase_date,
      car_make: data.car_make,
      car_model: data.car_model,
      car_year: data.car_year,
    };
    localReviews.push(newReview);
    res.json(newReview);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error inserting review' });
  }
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
