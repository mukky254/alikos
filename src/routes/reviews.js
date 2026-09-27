```js
// src/routes/reviews.js

const express = require('express');
const multer = require('multer');

const { getOne, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../lib/helpers');
const { saveFile } = require('../lib/storage');
const { withComputed } = require('./businesses');

const asyncRouter = require('../lib/asyncRouter');

const router = asyncRouter();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

/*
 * POST /api/reviews/business/:businessId
 *
 * Creates a review for a business.
 *
 * Important for Vercel:
 * - Database errors are reported clearly in the server log.
 * - Blob/file-storage errors are separated from database errors.
 * - Notification failure does NOT make an otherwise successful review fail.
 * - The response still contains the updated business when possible.
 */
router.post(
  '/business/:businessId',
  requireAuth,
  upload.single('photo'),
  async (req, res) => {
    const businessId = req.params.businessId;

    try {
      const { rating, text } = req.body || {};

      const r = parseInt(rating, 10);

      if (
        !r ||
        r < 1 ||
        r > 5 ||
        !text ||
        !String(text).trim()
      ) {
        return res.status(400).json({
          error: 'A rating (1-5) and review text are required.',
        });
      }

      /*
       * ------------------------------------------------------------
       * 1. Find the business
       * ------------------------------------------------------------
       */
      let biz;

      try {
        biz = await getOne(
          'SELECT * FROM businesses WHERE id = $1',
          [businessId]
        );
      } catch (error) {
        console.error(
          '[reviews] Failed to load business:',
          businessId,
          error
        );

        return res.status(500).json({
          error: 'Unable to load the business.',
        });
      }

      if (!biz) {
        return res.status(404).json({
          error: 'Business not found.',
        });
      }

      /*
       * ------------------------------------------------------------
       * 2. Create the review
       * ------------------------------------------------------------
       */
      let reviewId;

      try {
        const result = await run(
          `
            INSERT INTO reviews
              (business_id, user_id, rating, text)
            VALUES
              ($1, $2, $3, $4)
            RETURNING id
          `,
          [
            businessId,
            req.user.id,
            r,
            String(text).trim(),
          ]
        );

        reviewId = result?.rows?.[0]?.id;

        if (!reviewId) {
          console.error(
            '[reviews] Review inserted but no review ID was returned:',
            result
          );

          return res.status(500).json({
            error: 'The review could not be created.',
          });
        }
      } catch (error) {
        console.error(
          '[reviews] Failed to insert review:',
          error
        );

        return res.status(500).json({
          error: 'The review could not be saved.',
        });
      }

      /*
       * ------------------------------------------------------------
       * 3. Save review photo if one was supplied
       * ------------------------------------------------------------
       *
       * This is deliberately isolated from the review insert so the
       * server log tells us if Blob storage is the actual problem.
       */
      if (req.file) {
        try {
          console.log(
            '[reviews] Saving review photo:',
            req.file.originalname,
            req.file.mimetype,
            req.file.size
          );

          const stored = await saveFile(req.file, {
            prefix: 'review',
          });

          await run(
            `
              INSERT INTO review_photos
                (review_id, filename)
              VALUES
                ($1, $2)
            `,
            [reviewId, stored]
          );

          console.log(
            '[reviews] Review photo saved:',
            stored
          );
        } catch (error) {
          console.error(
            '[reviews] Review photo upload failed:',
            error
          );

          /*
           * The review itself already exists.
           *
           * Do not pretend the entire review failed. Tell the client
           * that the review was saved but the photo was not.
           */
          return res.status(201).json({
            warning:
              'Your review was saved, but the photo could not be uploaded.',
            reviewId,
          });
        }
      }

      /*
       * ------------------------------------------------------------
       * 4. Notify the business owner
       * ------------------------------------------------------------
       *
       * A notification is secondary. If notification fails, the review
       * must NOT become a 500 error.
       */
      if (
        biz.owner_id !== null &&
        biz.owner_id !== undefined &&
        Number(biz.owner_id) !== Number(req.user.id)
      ) {
        try {
          await notify(
            biz.owner_id,
            'review',
            `${req.user.name || 'A user'} left a ${r}-star review on ${biz.name}.`,
            biz.id
          );
        } catch (error) {
          console.error(
            '[reviews] Notification failed after review was created:',
            error
          );
        }
      }

      /*
       * ------------------------------------------------------------
       * 5. Reload business
       * ------------------------------------------------------------
       */
      let updated = biz;

      try {
        const refreshed = await getOne(
          'SELECT * FROM businesses WHERE id = $1',
          [businessId]
        );

        if (refreshed) {
          updated = refreshed;
        }
      } catch (error) {
        console.error(
          '[reviews] Failed to reload business:',
          error
        );
      }

      /*
       * ------------------------------------------------------------
       * 6. Calculate computed business data
       * ------------------------------------------------------------
       */
      let computedBusiness;

      try {
        computedBusiness = await withComputed(updated);
      } catch (error) {
        console.error(
          '[reviews] withComputed failed:',
          error
        );

        /*
         * The review is already successfully stored.
         * Return the raw business rather than converting a successful
         * review into a 500 response.
         */
        computedBusiness = updated;
      }

      /*
       * ------------------------------------------------------------
       * 7. Success
       * ------------------------------------------------------------
       */
      return res.status(201).json({
        business: computedBusiness,
        reviewId,
      });
    } catch (error) {
      /*
       * Final safety net.
       *
       * This is the error that will appear in Vercel Logs if something
       * unexpected happens outside the individual stages above.
       */
      console.error(
        '[reviews] UNHANDLED ERROR:',
        error
      );

      return res.status(500).json({
        error: 'Unable to submit review.',
      });
    }
  }
);


/*
 * POST /api/reviews/:id/helpful
 */
router.post('/:id/helpful', requireAuth, async (req, res) => {
  try {
    const review = await getOne(
      'SELECT * FROM reviews WHERE id = $1',
      [req.params.id]
    );

    if (!review) {
      return res.status(404).json({
        error: 'Review not found.',
      });
    }

    const existing = await getOne(
      `
        SELECT 1
        FROM review_votes
        WHERE review_id = $1
          AND user_id = $2
      `,
      [
        req.params.id,
        req.user.id,
      ]
    );

    if (existing) {
      await run(
        `
          DELETE FROM review_votes
          WHERE review_id = $1
            AND user_id = $2
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );

      await run(
        `
          UPDATE reviews
          SET helpful_count = GREATEST(0, helpful_count - 1)
          WHERE id = $1
        `,
        [req.params.id]
      );
    } else {
      await run(
        `
          INSERT INTO review_votes
            (review_id, user_id)
          VALUES
            ($1, $2)
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );

      await run(
        `
          UPDATE reviews
          SET helpful_count = helpful_count + 1
          WHERE id = $1
        `,
        [req.params.id]
      );
    }

    const updated = await getOne(
      'SELECT * FROM businesses WHERE id = $1',
      [review.business_id]
    );

    res.json({
      business: await withComputed(updated),
    });
  } catch (error) {
    console.error(
      '[reviews] Helpful vote failed:',
      error
    );

    res.status(500).json({
      error: 'Unable to update helpful vote.',
    });
  }
});


/*
 * PUT /api/reviews/:id/reply
 */
router.put('/:id/reply', requireAuth, async (req, res) => {
  try {
    const review = await getOne(
      'SELECT * FROM reviews WHERE id = $1',
      [req.params.id]
    );

    if (!review) {
      return res.status(404).json({
        error: 'Review not found.',
      });
    }

    const biz = await getOne(
      'SELECT * FROM businesses WHERE id = $1',
      [review.business_id]
    );

    if (!biz) {
      return res.status(404).json({
        error: 'Business not found.',
      });
    }

    if (
      biz.owner_id !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({
        error:
          'Only the business owner can reply to reviews.',
      });
    }

    const { reply } = req.body || {};

    if (!reply || !String(reply).trim()) {
      return res.status(400).json({
        error: 'Reply text is required.',
      });
    }

    await run(
      `
        UPDATE reviews
        SET
          owner_reply = $1,
          owner_reply_at = extract(epoch from now())::bigint
        WHERE id = $2
      `,
      [
        String(reply).trim(),
        req.params.id,
      ]
    );

    /*
     * Notification failure should not invalidate the owner reply.
     */
    try {
      await notify(
        review.user_id,
        'reply',
        `${biz.name} replied to your review.`,
        biz.id
      );
    } catch (error) {
      console.error(
        '[reviews] Reply notification failed:',
        error
      );
    }

    const updated = await getOne(
      'SELECT * FROM businesses WHERE id = $1',
      [review.business_id]
    );

    res.json({
      business: await withComputed(updated),
    });
  } catch (error) {
    console.error(
      '[reviews] Reply failed:',
      error
    );

    res.status(500).json({
      error: 'Unable to reply to review.',
    });
  }
});


module.exports = router;
```
