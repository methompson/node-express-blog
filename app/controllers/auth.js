const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = require('../controllers/db.js');
const {makeError, makeErrorResponse, sendError, valsInBody} = require('./utilities.js');

/**
 *
 * @param {*} req Express Request object
 * @param {*} res Express response object
 * @param {*} next Express next function
 */
const authenticateUser = (req, res, next) => {
  // We are looking for the user by their email address
  // We are creating a user variable in the function scope so that the
  // promise then statements can find it.
  let user;

  return new Promise((resolve, reject) => {
    if (!valsInBody(req.body, ['email', 'password'])){
      reject(makeError("Credentials not Provided", "Credentials Not Provided", 401));
      return;
    }

    resolve();
  })
    .then(() => {
      return getUserByEmail(req.body.email);
    })
    .then((result) => {

      // We assign the user data to this variable so that we can use it later
      // in the logUserIn function.
      user = result;

      // We return the bcrypt compare instance to return a true/false statement
      return bcrypt.compare(req.body.password, result.password);
    })
    .then((result) => {
      // Result is a boolean tha that indicates if the comparison is correct.
      // if result is false, the password is incorrect. We respond with a 401 error.
      if (result !== true){
        throw makeError("Invalid Credentials", "Invalid Credentials", 401);
      }

      const token = makeJWTToken(user, '2h');

      return res.status(200).send({
        token,
      });
    })
    .catch((err) => {
      saveFailedLogin(req.ip);
      const error = makeErrorResponse(err);
      sendError(error, res);
      return;
    });
};

const checkFailedLogins = (req, res, next) => {
  const cooldownMins = 30;
  const addr = req.ip;
  const startTime = new Date(
    new Date().getTime() - cooldownMins * 60 * 1000
  );
  pool.execute(`
    SELECT COUNT(id)
    FROM failed_logins
    WHERE address = ?
      AND date > ?
  `,
  [
    addr,
    startTime,
  ],
  (err, results, fields) => {
    // console.log(results[0]['COUNT(id)']);
    const failures = results[0]['COUNT(id)'];

    if (failures >= 10){
      res.status(403).end();
      saveFailedLogin(addr);
      return;
    }
    next();
  });
};

const saveFailedLogin = (addr) => {
  // console.log("Failed Login", addr);
  const now = new Date();
  pool.execute(`
    INSERT INTO failed_logins (
      address, date)
    VALUES (
      ?, ?
    )
  `,
  [
    addr,
    now
  ],
  (err, results, fields) => {
    if (err){
      console.log(err);
    }
  }
  );
};

const checkUserPasswordById = (id, password) => {
  const query = 'SELECT password FROM users WHERE id = ?';
  const params = [id];
  return checkUserPassword(query, params, password);
};

const checkUserPasswordByEmail = (email, password) => {
  const query = 'SELECT password FROM users WHERE email = ?';
  const params = [email];
  return checkUserPassword(query, params, password);
};

const checkUserPassword = (query, params, password) => {
  return new Promise((resolve, reject) => {
    pool.execute(
      query,
      params,
      (err, results, fields) => {
        if (err){
          reject(makeError("Database Server Error", err, 500));
          return;
        };

        if (results.length <= 0){
          reject(makeError("User Not Found", "User Not Found", 401));
          return;
        }

        resolve(results[0]);
      }
    );
  })
    .then((result) => {
      return bcrypt.compare(password, result.password);
    });
};

const getUserByEmail = (email) => {
  return getUserByParam('email', email);
};

const getUserById = (id) => {
  return getUserByParam('id', id);
};

const getUserByParam = (param, paramVal) => {

  return new Promise((resolve, reject) => {
    pool.execute(`
      SELECT id, firstName, lastName, email, userType, password
      FROM users
      WHERE ${param} = ?
    `,
    [paramVal],
    (err, results, fields) => {
      if (err){
        reject(makeError("Database Server Error", err, 500));
        return;
      };

      if (results.length <= 0){
        reject(makeError("User Not Found", "User Not Found", 401));
        return;
      }

      resolve(results[0]);
    });
  })
};

const makeJWTToken = (user, exp) => {
  return jwt.sign(
    {
      email:      user.email,
      userId:     user.id,
      firstName:  user.firstName,
      lastName:   user.lastName,
      userType:   user.userType,
    },
    global.jwtSecret,
    { expiresIn: exp }
  );
}

const authenticateToken = (req, res, next) => {
  if (!('_token' in req)){
    const error = makeError("Invalid Token", "No Token Provided", 401);
    sendError(error, res);
    return;
  }

  const token = req._token;
  jwt.verify(token, global.jwtSecret, (err, decoded) => {
    if (err){
      const error = makeError("Invalid Token", "Invalid Token", 401);
      sendError(error, res);
      return;
    }

    req._user = decoded;

    next();
  });
};

/**
 *
 * @param {Object} req Express Request object
 * @param {Object} res Express response object
 * @param {Function} next Express next function
 *
 * This middleware checks for the existence of the authorization header, retrieves
 * the JWT from it and verifies it.
 */
const getTokenFromHeaders = (req, res, next) => {
  // Do we have the authorization header?
  // Is the authorization header structured correctly?
  if (  !('authorization' in req.headers)
    ||  req.headers.authorization.split(' ').length < 2
    ||  req.headers.authorization.split(' ')[0] != "Bearer"
  ){
    const error = makeError("Authorization token not provided", "Authorization token not provided", 401);
    sendError(error, res);
    return;
  }

  req._token = req.headers.authorization.split(' ')[1];
  next();
};

const getTokenFromCookies = (req, res, next) => {
  console.log("Cookies", req.cookies);
  if ( !('kakAuthToken' in req.cookies)){
    const error = makeError("Authorization token not provided", "Authorization token not provided", 401);
    sendError(error, res);
    return;
  }

  req._token = req.cookies.kakAuthToken;
  next();
};

module.exports = {
  authenticateUser,
  authenticateToken,
  getTokenFromHeaders,
  getTokenFromCookies,
  makeJWTToken,
  getUserByEmail,
  getUserById,
  checkUserPasswordByEmail,
  checkUserPasswordById,
  checkFailedLogins,
};