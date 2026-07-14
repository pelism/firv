use std::collections::HashMap;
use uuid::Uuid;

use crate::models::request::FirvRequest;

pub struct Scratchpad {
    requests: HashMap<String, FirvRequest>,
}

impl Default for Scratchpad {
    fn default() -> Self {
        Self::new()
    }
}

impl Scratchpad {
    pub fn new() -> Self {
        Self {
            requests: HashMap::new(),
        }
    }

    pub fn create(&mut self, mut request: FirvRequest) -> String {
        let id = Uuid::new_v4().to_string();
        request.id = id.clone();
        self.requests.insert(id.clone(), request);
        id
    }

    pub fn get(&self, id: &str) -> Option<&FirvRequest> {
        self.requests.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut FirvRequest> {
        self.requests.get_mut(id)
    }

    pub fn update(&mut self, id: &str, request: FirvRequest) -> Result<(), String> {
        if !self.requests.contains_key(id) {
            return Err(format!("Scratchpad request {} not found", id));
        }
        self.requests.insert(id.to_string(), request);
        Ok(())
    }

    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        if self.requests.remove(id).is_none() {
            return Err(format!("Scratchpad request {} not found", id));
        }
        Ok(())
    }

    pub fn list(&self) -> Vec<&FirvRequest> {
        self.requests.values().collect()
    }

    pub fn take(&mut self, id: &str) -> Option<FirvRequest> {
        self.requests.remove(id)
    }
}
